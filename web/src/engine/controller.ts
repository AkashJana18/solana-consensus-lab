// Orchestrates the workers, the event buffers, the Pixi scenes and the display clock.
// React only observes the zustand store; nothing per-frame goes through React.
import type { Scene } from '../render/scene';
import { applyEvents, emptyView, type RunView } from '../store/runView';
import { protocolsFor, useStore, type Mode } from '../store/useStore';
import { compileTrigger, type Breakpoint, type HitCallback, type Matcher } from './breakpoint';
import { SimClient } from './client';
import { LiveClient, type LiveOptions } from './liveClient';
import type { EventsBatch, RunSource } from './runSource';
import { EventBuffer } from './eventBuffer';
import { isVisibleAt } from '../render/interp';
import type { Protocol, SimMeta, Traced } from './types';
import { withSeed } from './wasmMain';

interface Run {
  protocol: Protocol;
  client: RunSource;
  buffer: EventBuffer;
  view: RunView;
  scene: Scene | null;
  /** Set while a `reset` is outstanding; stale `advance` replies are ignored until it lands. */
  resetting: boolean;
  dirty: boolean;
}

const BASE_LOOKAHEAD_US = 300_000;
const STORE_FLUSH_MS = 66;
const POLL_MS = 200;

export class Controller {
  private runs = new Map<Protocol, Run>();
  private scenes = new Map<Protocol, Scene>();
  private displayTime = 0;
  private end = 0;
  private raf = 0;
  private lastFrame = 0;
  private lastFlush = 0;
  private lastPoll = 0;
  private generation = 0;
  private stepPending: Protocol | null = null;
  /** Endpoint and signature for a live run. Read by the LiveClient factory in configure(). */
  private liveOptions: LiveOptions = {};

  private bp: Breakpoint | null = null;
  private bpMatch: Matcher | null = null;
  private bpHit: HitCallback | null = null;
  private pendingHit: { e: Traced | null; t: number } | null = null;
  private configuredListeners = new Set<(mode: Mode, scenarioJson: string, seed: number) => void>();

  constructor() {
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  get time(): number {
    return this.displayTime;
  }

  /** (Re)build the simulations for a mode/scenario/seed. Returns when meta is known. */
  async configure(mode: Mode, scenarioJson: string, seed: number): Promise<void> {
    const gen = ++this.generation;
    for (const r of this.runs.values()) r.client.terminate();
    this.runs.clear();
    const protocols = protocolsFor(mode);
    const store = useStore.getState();
    store.set({ playing: false, displayTime: 0, fatal: null });
    store.resetRuns(protocols);
    this.displayTime = 0;
    const json = withSeed(scenarioJson, seed);
    const created = protocols.map((p) => {
      const client: RunSource = p === 'live' ? new LiveClient(this.liveOptions) : new SimClient(p);
      const run: Run = { protocol: p, client, buffer: new EventBuffer(), view: emptyView(p), scene: this.scenes.get(p) ?? null, resetting: false, dirty: true };
      client.onEvents((b) => this.onBatch(run, b));
      client.onError = (m) => this.fail(run, m);
      return run;
    });
    for (const r of created) this.runs.set(r.protocol, r);
    try {
      const metas = await Promise.all(created.map((r) => r.client.init(json)));
      if (gen !== this.generation) return;
      created.forEach((r, i) => this.attachMeta(r, metas[i]));
      this.end = Math.max(...created.map((r) => r.client.end));
      // A live run has nothing to step through, it has something to watch, but it does not
      // start watching until the panel's Start button says so: see watchLive(). So `playing`
      // stays false here, and the clock advances from the first observation instead.
      useStore.getState().set({ end: this.end, playing: false });
      this.requestLookahead();
      this.poll(true);
    } catch (err) {
      if (gen !== this.generation) return;
      useStore.getState().set({ fatal: err instanceof Error ? err.message : String(err) });
    }
    if (gen === this.generation) for (const l of this.configuredListeners) l(mode, scenarioJson, seed);
  }

  /** True once someone has asked this live run to poll, false again after stopLive(). */
  get liveRunning(): boolean {
    const run = this.runs.get('live');
    return !!run && run.client.live === true && (run.client as LiveClient).started;
  }

  /**
   * Start watching a signature on devnet. This is the consent point: before it, a live run
   * makes no network request at all, so a shared `?mode=live` link cannot spend a third
   * party's rate limit on behalf of a visitor who clicked nothing.
   *
   * Returns false when the live mode is not the one currently configured.
   */
  watchLive(signature: string | null, endpoint?: string): boolean {
    const run = this.runs.get('live');
    if (!run || !run.client.live) return false;
    this.liveOptions = { ...this.liveOptions, signature, endpoint: endpoint ?? this.liveOptions.endpoint };
    (run.client as LiveClient).watch(signature, endpoint);
    (run.client as LiveClient).start();
    // Resume rather than pause. The clock only advances while playing, so pausing here would
    // leave the new signature's events buffered and unrevealed until someone pressed play.
    useStore.getState().set({ playing: true });
    return true;
  }

  /**
   * Stop polling and hold the recording. The buffer is kept so Back still replays what was
   * observed; a live source cannot re-observe the past, so this is "stop asking", not "reset".
   */
  stopLive(): void {
    const run = this.runs.get('live');
    if (!run || !run.client.live) return;
    (run.client as LiveClient).stop();
    useStore.getState().set({ playing: false });
  }

  /** Called every time `configure()` finishes (successfully or with a fatal error) for the latest request. */
  onConfigured(listener: (mode: Mode, scenarioJson: string, seed: number) => void): () => void {
    this.configuredListeners.add(listener);
    return () => this.configuredListeners.delete(listener);
  }

  // ---------------------------------------------------------------- breakpoints

  /**
   * Arm a stop condition. While playing, the clock halts on the exact sim time of the first
   * matching event (or at `trigger.atUs` / `deadlineUs`), pauses, and calls `onHit` once with
   * the event (null for time/deadline stops). The breakpoint is cleared when it fires.
   */
  setBreakpoint(bp: Breakpoint | null, onHit?: HitCallback): void {
    this.bp = bp;
    this.bpMatch = bp ? compileTrigger(bp.trigger) : null;
    this.bpHit = bp ? onHit ?? null : null;
    this.pendingHit = null;
  }

  get breakpoint(): Breakpoint | null {
    return this.bp;
  }

  /** Clamp the frame's clock target to the first breakpoint hit in (displayTime, target]. */
  private applyBreakpoint(target: number): number {
    const bp = this.bp;
    if (!bp) return target;
    if (bp.trigger.type === 'time') {
      if (target >= bp.trigger.atUs) {
        this.pendingHit = { e: null, t: bp.trigger.atUs };
        return Math.max(this.displayTime, bp.trigger.atUs);
      }
      return target;
    }
    const run = this.runs.get(bp.protocol);
    if (!run) return target;
    // After a rewind the buffer is empty until the worker replies; hold the clock rather than skip events.
    if (run.resetting) return this.displayTime;
    const match = this.bpMatch!;
    const hit = run.buffer.range(this.displayTime, target).find((e) => match(e, run.view));
    if (hit) {
      this.pendingHit = { e: hit, t: hit.t };
      return hit.t;
    }
    if (bp.deadlineUs !== undefined && target >= bp.deadlineUs) {
      this.pendingHit = { e: null, t: bp.deadlineUs };
      return Math.max(this.displayTime, bp.deadlineUs);
    }
    return target;
  }

  private attachMeta(run: Run, meta: SimMeta): void {
    run.view = { ...emptyView(run.protocol, meta), rpcNode: meta.scenario.hero_tx.rpc_node ?? meta.n - 1 };
    run.dirty = true;
    run.scene?.setMeta(meta);
    // `node` arrives from the URL unchecked, and a node that does not exist has no state
    // to inspect: the panels came up empty with no indication why. meta is the first
    // point where the validator count is known, so drop an impossible selection here.
    const s = useStore.getState();
    if (s.selectedNode !== null && (s.selectedNode < 0 || s.selectedNode >= meta.n)) s.set({ selectedNode: null });
  }

  attachScene(protocol: Protocol, scene: Scene | null): void {
    if (scene) this.scenes.set(protocol, scene);
    else this.scenes.delete(protocol);
    const run = this.runs.get(protocol);
    if (!run) return;
    run.scene = scene;
    if (scene && run.view.meta) scene.setMeta(run.view.meta);
  }

  private fail(run: Run, message: string): void {
    run.view = { ...run.view, error: message };
    run.dirty = true;
  }

  private onBatch(run: Run, b: EventsBatch): void {
    if (run.resetting && !b.reset) return; // stale reply from before the reset
    run.resetting = false;
    run.buffer.append(b.events);
    run.view = { ...run.view, workerNow: b.now };
    run.dirty = true;
    // A live run declares no horizon, so the timeline's right edge has to follow it. Reading
    // it from the source rather than from configure() is what lets Back replay the recording.
    if (run.client.live && b.now > this.end) {
      this.end = b.now;
      useStore.getState().set({ end: this.end });
    }
    if (this.stepPending === run.protocol) {
      this.stepPending = null;
      this.displayTime = Math.max(this.displayTime, b.now);
    }
  }

  // ---------------------------------------------------------------- transport

  play(): void {
    if (this.displayTime >= this.end && this.end > 0) this.seek(0);
    useStore.getState().set({ playing: true });
  }

  pause(): void {
    useStore.getState().set({ playing: false });
  }

  toggle(): void {
    useStore.getState().playing ? this.pause() : this.play();
  }

  /** Process exactly one engine event on the primary run and move the clock to it. */
  stepEvent(): void {
    this.pause();
    const primary = this.runs.get(useStore.getState().mode === 'tower' ? 'tower' : 'alpenglow');
    if (!primary || primary.client.done) return;
    // Consume anything already buffered ahead of the clock first, one event at a time.
    const next = primary.buffer.range(this.displayTime, Infinity)[0];
    if (next) {
      this.displayTime = next.t;
      return;
    }
    this.stepPending = primary.protocol;
    primary.client.step();
  }

  stepSlot(): void {
    this.pause();
    const slotUs = (this.primaryMeta()?.slot_ms ?? 400) * 1000;
    this.seek(Math.min(this.end, this.displayTime + slotUs));
  }

  private primaryMeta(): SimMeta | null {
    for (const r of this.runs.values()) if (r.view.meta) return r.view.meta;
    return null;
  }

  /** Move the display clock. Backwards scrubs re-create the deterministic Sim in the worker. */
  seek(tMicros: number): void {
    const t = Math.max(0, Math.min(this.end || tMicros, tMicros));
    if (t < this.displayTime) {
      for (const run of this.runs.values()) {
        // The past cannot be re-observed. A live run keeps its buffer, so Back inside a live
        // trace replays what was already recorded rather than refetching anything.
        if (run.client.live) continue;
        run.buffer.clear();
        run.scene?.particles.clear();
        const meta = run.view.meta;
        run.view = meta ? { ...emptyView(run.protocol, meta), rpcNode: meta.scenario.hero_tx.rpc_node ?? meta.n - 1 } : emptyView(run.protocol);
        run.resetting = true;
        run.dirty = true;
        run.client.reset(t);
      }
    }
    this.displayTime = t;
    this.requestLookahead();
    this.lastPoll = 0;
  }

  // ---------------------------------------------------------------- frame loop

  private loop(nowMs: number): void {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastFrame ? Math.min(100, nowMs - this.lastFrame) : 0;
    this.lastFrame = nowMs;
    const state = useStore.getState();

    if (state.playing && this.runs.size) {
      let target = this.displayTime + dt * 1000 * state.speed;
      // Never outrun the workers: stall the clock instead of skipping events.
      // Never outrun the workers: stall the clock instead of skipping events. A live run is
      // excluded: it has no materialised future, so its `now` would pin the clock forever.
      for (const r of this.runs.values()) if (!r.client.live && !r.client.done && !r.resetting) target = Math.min(target, r.client.now);
      target = Math.min(target, this.end);
      target = this.applyBreakpoint(target);
      this.displayTime = Math.max(this.displayTime, target);
      // Stop at the declared horizon, which is how a simulation ends. A live run has no
      // declared horizon: its `end` is the newest observation and grows, so this check fired
      // on the very first frame (0 >= 0) and left live mode paused and looking broken.
      const anyLive = [...this.runs.values()].some((r) => r.client.live);
      if (!anyLive && this.displayTime >= this.end) state.set({ playing: false });
    }

    this.requestLookahead();
    for (const run of this.runs.values()) this.consume(run);

    if (this.pendingHit) {
      // Fire after consume() so the views already include the matching event.
      const hit = this.pendingHit;
      const cb = this.bpHit;
      this.setBreakpoint(null);
      state.set({ playing: false });
      this.poll(true);
      cb?.(hit.e, hit.t);
    }

    if (nowMs - this.lastFlush > STORE_FLUSH_MS) {
      this.lastFlush = nowMs;
      const patch: Partial<Record<Protocol, RunView>> = {};
      let any = false;
      for (const run of this.runs.values()) {
        if (run.dirty) {
          patch[run.protocol] = run.view;
          run.dirty = false;
          any = true;
        }
      }
      if (any) state.set({ runs: { ...state.runs, ...patch }, displayTime: this.displayTime });
      else if (state.displayTime !== this.displayTime) state.set({ displayTime: this.displayTime });
    }
    if (state.playing && nowMs - this.lastPoll > POLL_MS) {
      this.lastPoll = nowMs;
      this.poll(false);
    }
  }

  private requestLookahead(): void {
    const speed = useStore.getState().speed;
    const lookahead = BASE_LOOKAHEAD_US * Math.max(1, speed);
    for (const r of this.runs.values()) {
      if (r.client.live || r.resetting || r.client.done) continue;
      if (r.client.now < this.displayTime + lookahead) r.client.advance(this.displayTime + lookahead);
    }
  }

  private consume(run: Run): void {
    const events = run.buffer.drain(this.displayTime);
    if (events.length) {
      run.view = applyEvents(run.view, events);
      run.dirty = true;
      const scene = run.scene;
      if (scene) {
        const now = this.displayTime;
        for (const e of events) {
          if (e.type === 'msg_sent' && isVisibleAt(e.t, e.arrive_at, !!e.dropped, now)) scene.emit(e, run.view.heroSlot);
        }
      }
    }
    const scene = run.scene;
    if (scene) {
      const v = run.view;
      scene.setState({
        leader: v.leader,
        offline: v.offline,
        partition: v.partition,
        rpcNode: v.rpcNode,
        selected: useStore.getState().selectedNode,
        heroSlot: v.heroSlot,
      });
      scene.update(this.displayTime);
    }
  }

  /** Poll inspect()/metrics() from each worker (5 Hz while playing; also on demand). */
  poll(force: boolean): void {
    const node = useStore.getState().selectedNode ?? 0;
    for (const run of this.runs.values()) {
      if (run.resetting && !force) continue;
      void run.client.inspect(node).then((data) => {
        run.view = { ...run.view, inspect: data };
        run.dirty = true;
      });
      void run.client.metrics().then((data) => {
        run.view = { ...run.view, metrics: data };
        run.dirty = true;
      });
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const r of this.runs.values()) r.client.terminate();
    this.runs.clear();
  }
}

export const controller = new Controller();

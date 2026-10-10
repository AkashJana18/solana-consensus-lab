// Traces a real transaction on devnet, emitting the same TraceEvent union the Rust engine
// does, so the timeline, the events feed and the transaction stepper render it unchanged.
//
// What this can honestly report, and what it cannot:
//
//   Observable from a public RPC: the slot a transaction landed in, that slot's blockTime,
//   the commitment levels the transaction has reached, the parent chain, and which slots
//   produced no block at all. On Alpenglow a skipped slot is the outside view of a Skip
//   certificate, which is the one consensus behaviour visible from outside.
//
//   Not observable: notarization votes, certificates, Pool events, Votor flags, Rotor relay
//   choice, shred propagation. SIMD-0326 keeps Alpenglow votes as off-chain gossip, so no
//   outside observer sees them and no RPC method exposes them. Everything the simulation
//   teaches about mechanism stays simulated; this run only ever adds observed outcome.
//
// Two constraints shape the code. The public endpoint is free tier and rate limited, so
// polling is single flight with backoff that honours Retry-After. And a live run cannot be
// re-created the way a deterministic Sim can, so the controller has to treat it specially.
import type { EventsBatch, RunSource } from './runSource';
import type { BlockHash, CommitmentLevel, Inspect, Metrics, Protocol, Scenario, SimMeta, TraceEvent, Traced } from './types';

export const DEVNET_RPC = 'https://api.devnet.solana.com';

/** Poll cadence. The free tier allows 150 requests/10s, so this is far under the ceiling. */
const POLL_MS = 700;
/**
 * Jitter applied to each interval. Without it every open tab, and every visitor behind one
 * NAT, retries in lockstep against a per-IP limit, which is how a shared endpoint gets
 * hammered into 429 by its own users rather than by anyone abusing it.
 */
const POLL_JITTER = 0.15;
/** Backoff ceiling, so a throttled endpoint is not hammered. */
const MAX_BACKOFF_MS = 30_000;
/** How far behind the tip we will catch up on a single request. */
const MAX_CATCHUP_SLOTS = 400;
/**
 * Ceiling on remembered slots. The set only exists to keep a re-watched range from emitting
 * the same block twice, so it can drop entries well before it is full, but it has to be
 * bounded: devnet makes ~4 slots a second and a tab left running all day would otherwise
 * grow it without limit.
 */
const MAX_SEEN_SLOTS = 8_000;
/** A request that has not answered in this long is treated as failed, so the loop recovers. */
const RPC_TIMEOUT_MS = 10_000;
/** The watched transaction maps to tx id 0, which is what the timeline treats as the hero tx. */
const WATCHED_TX = 0;
/**
 * Reserved node id for the RPC observer. A public RPC never says which validator reported a
 * commitment and `commitment.node` is required, so the observer is modelled as its own node.
 */
const OBSERVER_NODE = 0;

export interface LiveOptions {
  endpoint?: string;
  signature?: string | null;
  /** Test seam: injected transport, so the suite never touches the network. */
  fetchImpl?: typeof fetch;
  pollMs?: number;
  /** Test seam: run one poll synchronously instead of on a timer. */
  manual?: boolean;
  /** Test seam: the per-request deadline, so a hung response can be exercised quickly. */
  rpcTimeoutMs?: number;
  /** Test seam: the elapsed-microsecond clock, so cadence can be measured deterministically. */
  clock?: () => number;
}

/** Last-known state of the watched transaction. */
interface SeenLevel {
  slot: number;
  t: number;
}

/**
 * Reduce a base58 blockhash to the 53-bit integer BlockHash is. Mirrors the masking in
 * protocol/dissemination.rs so a live hash round trips through JSON exactly and compares
 * like a simulated one. It is an opaque identifier: equality only, never ordering.
 */
export function maskBlockHash(base58: string): BlockHash {
  // FNV-1a over the string. Stable across runs and platforms, which is all that is needed.
  let h = 0x811c9dc5;
  for (let i = 0; i < base58.length; i++) {
    h ^= base58.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & ((1 << 53) - 1)) | 1;
}

export class LiveClient implements RunSource {
  readonly protocol: Protocol = 'live';
  readonly live = true;

  now = 0;
  end = 0;
  done = false;
  meta: SimMeta | null = null;
  onError: ((msg: string) => void) | null = null;

  private endpoint: string;
  private signature: string | null;
  private fetchImpl: typeof fetch;
  private pollMs: number;
  private manual: boolean;
  private clock: () => number;
  private rpcTimeoutMs: number;

  private listeners = new Set<(b: EventsBatch) => void>();
  private pending: Traced[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private inflight = false;
  private backoffMs: number;
  /** Set by start(), cleared by stop(). False means this run makes no request at all. */
  started = false;
  /** Aborts the in-flight request when the run is stopped, so none lands after the fact. */
  private inFlightAbort: AbortController | null = null;
  /** True while the tab is hidden; polling waits rather than burning a rate-limited quota. */
  private hidden = false;
  /** Set once the visibilitychange listener is attached, so start() cannot double-bind it. */
  private visibilityBound = false;
  /** Dropped on a visibility change, so the loop does not follow the old cadence blindly. */
  private onVisibility = () => {
    this.hidden = document.visibilityState === 'hidden';
    if (!this.hidden && this.started) this.schedule();
  };

  /**
   * Elapsed-microsecond clock. performance.now() rather than Date.now() because its
   * resolution is sub-millisecond, and Date.now()'s millisecond granularity made every event
   * stamped inside one millisecond collapse to the same value. It is also monotonic, so a
   * wall-clock adjustment cannot make event times go backwards.
   */
  private t0Us: number;
  private lastT = 0;

  private tip: number | null = null;
  private seenSlots = new Set<number>();
  private levels: Partial<Record<CommitmentLevel, SeenLevel>> = {};
  private stages = new Set<string>();
  private connState: string | null = null;
  private slotMs: number | null = null;
  private cadenceReported = false;
  private lastTipAtUs: number | null = null;

  constructor(opts: LiveOptions = {}) {
    this.t0Us = (opts.clock ?? (() => performance.now() * 1000))();
    this.endpoint = opts.endpoint ?? DEVNET_RPC;
    this.signature = opts.signature ?? null;
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.pollMs = opts.pollMs ?? POLL_MS;
    this.manual = opts.manual ?? false;
    this.clock = opts.clock ?? (() => performance.now() * 1000);
    this.rpcTimeoutMs = opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
    this.backoffMs = this.pollMs;
  }

  /** Point at a different signature (or endpoint) and restart the trace from now. */
  watch(signature: string | null, endpoint?: string): void {
    if (endpoint) this.endpoint = endpoint;
    this.signature = signature;
    this.stopped = false;
    this.t0Us = this.clock();
    this.lastT = 0;
    this.tip = null;
    this.lastTipAtUs = null;
    this.seenSlots.clear();
    this.levels = {};
    this.stages.clear();
    this.connState = null;
    this.cadenceReported = false;
    this.backoffMs = this.pollMs;
    this.meta = this.synthMeta();
    this.emit({ type: 'rpc_conn', state: 'connecting' });
    if (this.meta) this.dispatch(this.meta);
    // Deliver it now rather than on the next tick. start() may never follow (the panel can
    // be armed and left), and a connection state that only appears once polling begins is
    // exactly the "looks frozen, nothing in the log" failure this panel exists to avoid.
    this.flush();
  }

  /**
   * Begin polling. Separated from init() and from watch() on purpose: both of those run
   * while the app is merely configured, so a shared `?mode=live` link would otherwise spend
   * the public endpoint's rate limit on a visitor who never pressed anything.
   *
   * Idempotent, so pressing Start twice does not double the request rate.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    if (typeof document !== 'undefined' && !this.visibilityBound) {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.visibilityBound = true;
    }
    void this.tick();
  }

  /** Stop asking. The trace already recorded is kept; the past cannot be re-observed. */
  stop(): void {
    this.started = false;
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.inFlightAbort?.abort();
    this.inFlightAbort = null;
    this.setConn('stopped');
    this.flush();
  }

  // ------------------------------------------------------------ RunSource surface

  /**
   * Resolves meta so the timeline and panels have something to draw, and deliberately makes
   * no network request. Polling begins at start(), which the panel calls from its button.
   */
  async init(): Promise<SimMeta> {
    this.t0Us = this.clock();
    this.meta = this.synthMeta();
    this.dispatch(this.meta);
    this.flush();
    return this.meta;
  }

  onEvents(l: (b: EventsBatch) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get isBusy(): boolean {
    return this.inflight;
  }

  /** A live run has no future to materialise, so this is a no-op by design. */
  advance(_toMicros: number): boolean {
    return false;
  }

  step(): boolean {
    return false;
  }

  /**
   * Cannot be honoured: a backward scrub re-creates a deterministic Sim, and the past cannot
   * be re-observed. The controller refuses the scrub rather than calling this.
   */
  reset(_toMicros: number): void {}

  async inspect(_node: number): Promise<Inspect | null> {
    return null;
  }

  async metrics(): Promise<Metrics | null> {
    return null;
  }

  terminate(): void {
    this.started = false;
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.inFlightAbort?.abort();
    this.inFlightAbort = null;
    if (this.visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.visibilityBound = false;
    }
    this.listeners.clear();
    this.pending = [];
  }

  // ------------------------------------------------------------ polling

  /**
   * One JSON-RPC call, with a deadline.
   *
   * The deadline matters more than it looks: without it a request that never settles leaves
   * `inflight` true forever, and because the single-flight guard returns before the `finally`
   * that re-arms the timer, the whole poll loop dies with no error and no event. A stalled
   * app is the one failure mode a live trace must never have.
   */
  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const ac = new AbortController();
    this.inFlightAbort = ac;
    const timer = setTimeout(() => ac.abort(), this.rpcTimeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ac.signal,
      });
    } catch (e) {
      // A fetch that rejects for its own reasons (offline, DNS, CORS) reaches us unchanged;
      // only our own deadline and stop() need the "timed out" wording.
      if (ac.signal.aborted && !this.stopped) {
        const err = new Error(`${method}: timed out after ${this.rpcTimeoutMs} ms`) as Error & { timedOut?: boolean };
        err.timedOut = true;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (this.inFlightAbort === ac) this.inFlightAbort = null;
    }
    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after');
      const err = new Error(`${method}: HTTP ${res.status}${retryAfter ? `, retry after ${retryAfter}s` : ''}`) as Error & {
        status?: number;
        retryAfterMs?: number;
      };
      err.status = res.status;
      if (retryAfter) err.retryAfterMs = Number(retryAfter) * 1000;
      throw err;
    }
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message ?? 'rpc error'}`);
    return body.result as T;
  }

  private schedule(): void {
    if (this.stopped || this.manual || this.hidden) return;
    if (this.timer !== null) clearTimeout(this.timer);
    // Jitter, so N tabs do not converge on the same instant and collectively trip the limit.
    const spread = this.backoffMs * POLL_JITTER;
    const wait = Math.max(0, Math.round(this.backoffMs - spread + Math.random() * spread * 2));
    this.timer = setTimeout(() => void this.tick(), wait);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    // Already polling. Returning here must still re-arm, otherwise a tick that lands on top
    // of a slow one leaves the loop with no timer and it never runs again. This is the one
    // line where a "harmless" early return silently ends the feature.
    if (this.inflight) {
      this.schedule();
      return;
    }
    this.inflight = true;
    try {
      await this.poll();
      this.backoffMs = this.pollMs;
      this.setConn('connected');
    } catch (e) {
      const err = e as Error & { status?: number; retryAfterMs?: number };
      const msg = err.message;
      if (err.status === 429 || err.status === 503) {
        // Throttled. A live trace that silently stalls looks like a broken app, so say so.
        this.backoffMs = Math.min(err.retryAfterMs ?? Math.max(this.backoffMs * 2, this.pollMs), MAX_BACKOFF_MS);
        this.setConn('retrying', msg);
      } else if (err.status !== undefined) {
        this.setConn('error', msg);
        this.backoffMs = MAX_BACKOFF_MS;
      } else {
        // Includes our own timeout. Say so plainly: an endpoint that accepts the connection
        // and then stops answering is exactly what the connection state is there to report.
        this.setConn('retrying', msg);
        this.backoffMs = Math.min(Math.max(this.backoffMs * 2, this.pollMs), MAX_BACKOFF_MS);
      }
    } finally {
      this.inflight = false;
      this.flush();
      this.schedule();
    }
  }

  private async poll(): Promise<void> {
    const tip = await this.rpc<number>('getSlot', []);
    const nowUs = this.stamp();

    if (this.tip === null) {
      this.tip = tip;
      // Cadence baseline, set wherever the tip is first observed. It belongs here rather
      // than in init() because watch() clears the tip, and a baseline taken before a Trace
      // click would be stale and the cadence would never be measured at all.
      this.lastTipAtUs = nowUs;
      this.emit({ type: 'slot_start', slot: tip, leader: OBSERVER_NODE });
    } else if (tip > this.tip) {
      const from = this.tip + 1;
      const span = tip - this.tip;
      if (span <= MAX_CATCHUP_SLOTS) {
        // One getBlocks for the whole range. A getBlock per slot is what earns a 429.
        // commitment must be 'confirmed' or better: devnet rejects anything below it with
        // -32602 "Method does not support commitment below `confirmed`". Verified against
        // the public endpoint, which is how this was found.
        const blocks = await this.rpc<(number | null)[]>('getBlocks', [from, tip, { commitment: 'confirmed' }]);
        for (let i = 0; i < blocks.length; i++) {
          const slot = from + i;
          if (this.seenSlots.has(slot)) continue;
          // Bounded: drop the oldest half rather than growing all session. A slot older than
          // this will never be re-requested, because a poll only ever asks from tip+1.
          if (this.seenSlots.size > MAX_SEEN_SLOTS) {
            const drop = [...this.seenSlots].slice(0, this.seenSlots.size >> 1);
            for (const s of drop) this.seenSlots.delete(s);
          }
          this.seenSlots.add(slot);
          if (blocks[i] === null) this.emit({ type: 'slot_skipped', slot }, nowUs);
          else this.emit({ type: 'block_produced', slot, hash: maskBlockHash(String(blocks[i])), parent: 0, leader: OBSERVER_NODE, txs: [], vote_txs: 0 }, nowUs);
        }
      } else {
        // We were away too long to backfill; do not pretend to have observed the gap.
        this.seenSlots.clear();
        this.emit({ type: 'log', msg: `tip advanced ${span} slots while away, resynced without backfilling` }, nowUs);
      }
      // Measured cadence, not an assumed one: devnet has been seen at roughly 234-244 ms a
      // slot against mainnet's 400 ms, and the timeline should show what actually happened.
      if (this.lastTipAtUs !== null && span > 0) {
        // Event times are microseconds and slot_ms is milliseconds.
        const measured = Math.round((nowUs - this.lastTipAtUs) / span / 1000);
        // Only trust a plausible value: a poll that lands late would otherwise report a
        // cadence of zero or of the polling interval.
        if (measured > 0 && measured < 5_000 && measured !== this.slotMs) {
          this.slotMs = measured;
          if (this.meta) this.meta = { ...this.meta, slot_ms: measured };
          // The controller snapshots meta once at configure, so a changed cadence would
          // never reach the UI. Announce it instead: it is an observed fact about devnet
          // and the panel should not be the only place that learns it.
          if (!this.cadenceReported) {
            this.cadenceReported = true;
            this.emit(
              { type: 'log', msg: `measured devnet slot cadence: ${measured} ms per slot (mainnet is 400 ms)` },
              nowUs,
            );
          }
        }
      }
      this.lastTipAtUs = nowUs;
      this.tip = tip;
      this.emit({ type: 'slot_start', slot: tip, leader: OBSERVER_NODE }, nowUs);
    }

    if (this.signature) await this.pollSignature();
  }

  private async pollSignature(): Promise<void> {
    const sig = this.signature;
    if (!sig) return;
    // searchTransactionHistory is the expensive flag on the public endpoint: it scans the
    // full history for the signature. It is only needed until the transaction is located,
    // and devnet routinely takes a second or two to see a fresh one, so polling it forever
    // would spend the rate limit on a scan whose answer cannot change once we have it.
    const located = this.levels.processed !== undefined;
    const res = await this.rpc<{
      value: (null | { slot: number | null; confirmationStatus: string | null; err: object | null })[];
      // The signature goes in as a list: the first parameter is an array of signatures,
      // and passing a bare string fails with -32602 "expected a sequence". Also found
      // against the public endpoint rather than in the mocked tests.
    }>('getSignatureStatuses', [[sig], { searchTransactionHistory: !located }]);
    const st = res.value[0];
    if (!st || st.slot === null) return;

    const t = this.stamp();
    // The RPC reports the current status and never when it changed, so `t` is the moment we
    // observed the transition, not the moment devnet reached it. Labelled as observed, and
    // the one authoritative timestamp devnet gives us is the block's own blockTime.
    const record = (level: CommitmentLevel) => {
      if (this.levels[level]) return;
      this.levels[level] = { slot: st.slot!, t };
      this.emit({ type: 'commitment', node: OBSERVER_NODE, slot: st.slot!, hash: 0, level }, t);
      const stage = level === 'processed' ? 'included_in_block' : level;
      if (!this.stages.has(stage)) {
        this.stages.add(stage);
        this.emit({ type: 'tx_stage', tx: WATCHED_TX, stage, slot: st.slot!, detail: sig }, t);
      }
      if (level === 'processed') void this.attachBlockTime(st.slot!, sig);
    };

    const level = (st.confirmationStatus ?? 'processed') as CommitmentLevel;
    if (level === 'processed') record('processed');
    else if (level === 'confirmed') {
      record('processed');
      record('confirmed');
    } else if (level === 'finalized') {
      record('processed');
      record('confirmed');
      record('finalized');
    }
    if (st.err) this.emit({ type: 'log', msg: `transaction failed on chain: ${JSON.stringify(st.err)}` }, t);
  }

  private async attachBlockTime(slot: number, sig: string): Promise<void> {
    try {
      const bt = await this.rpc<number | null>('getBlockTime', [slot]);
      if (bt === null) return;
      // Stamped when we learned it, not at the block's own time: the block was produced
      // before we noticed it, so a true timestamp here would move the clock backwards and
      // force the buffer to re-sort. The value itself is devnet's, carried in the message.
      this.emit({ type: 'log', msg: `slot ${slot} blockTime ${new Date(bt * 1000).toISOString()} for ${sig.slice(0, 12)}…` });
    } catch {
      /* enrichment only; a failure here must not break the trace */
    }
  }

  // ------------------------------------------------------------ emitting

  /** Monotonic microseconds since the run started. The buffer re-sorts if this ever goes back. */
  private stamp(): number {
    const t = this.clock() - this.t0Us;
    if (t > this.lastT) this.lastT = t;
    return this.lastT;
  }

  private emit(e: TraceEvent, t?: number): void {
    this.pending.push({ t: t ?? this.stamp(), ...e } as Traced);
  }

  private setConn(state: 'connecting' | 'connected' | 'retrying' | 'error' | 'stopped', detail?: string): void {
    if (this.connState === state && detail === undefined) return;
    this.connState = state;
    this.emit({ type: 'rpc_conn', state, detail });
  }

  private dispatch(meta: SimMeta): void {
    this.meta = meta;
    const batch: EventsBatch = { events: [], now: this.now, done: false, reset: true };
    for (const l of this.listeners) l(batch);
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    const last = events[events.length - 1].t;
    // A live run has no declared horizon, so `end` grows to the newest observation. The
    // controller relies on this rather than a configure-time value.
    this.now = last;
    this.end = last;
    if (this.meta && this.meta.duration_us !== last) this.meta = { ...this.meta, duration_us: last };
    for (const l of this.listeners) l({ events, now: last, done: false, reset: false });
  }

  /** Test seam: run one poll now and settle. */
  async pollOnceForTest(): Promise<void> {
    await this.tick();
  }

  private synthMeta(): SimMeta {
    const scenario: Scenario = {
      name: 'devnet-live',
      description: 'Live devnet, observed',
      seed: 0,
      duration_ms: 0,
      validators: { count: 1 },
      faults: [],
      hero_tx: { submit_at_ms: 0, rpc_node: OBSERVER_NODE },
      params: { slot_ms: this.slotMs ?? 400, leader_window: 4, exec_delay_ms: 0 },
    };
    return {
      protocol: 'live',
      n: 1,
      stakes: [1],
      total_stake: 1,
      regions: ['devnet'],
      node_region: [0],
      leaders: [],
      window: 4,
      slot_ms: this.slotMs ?? 400,
      num_slots: 0,
      duration_us: this.end,
      scenario,
    };
  }
}
// Main-thread handle on a simulation worker. One instance per protocol run.
import type { FromWorker, ToWorker } from './protocol';
import type { Inspect, Metrics, Protocol, SimMeta, Traced } from './types';

export interface EventsBatch {
  events: Traced[];
  now: number;
  done: boolean;
  reset: boolean;
}

type Listener = (b: EventsBatch) => void;

export class SimClient {
  readonly protocol: Protocol;
  private worker: Worker;
  private metaResolve: ((m: SimMeta) => void) | null = null;
  private metaReject: ((e: Error) => void) | null = null;
  private inspectResolve: ((i: Inspect) => void) | null = null;
  private metricsResolve: ((m: Metrics) => void) | null = null;
  private listeners = new Set<Listener>();
  /** True while an `advance`/`step`/`reset` is in flight (we never pipeline them). */
  private busy = false;
  /** Latest sim time known to be materialised in the worker. */
  now = 0;
  end = 0;
  done = false;
  meta: SimMeta | null = null;
  onError: ((msg: string) => void) | null = null;

  constructor(protocol: Protocol) {
    this.protocol = protocol;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    this.worker.onerror = (ev) => this.onError?.(ev.message);
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker): void {
    switch (m.type) {
      case 'meta':
        this.meta = m.meta;
        this.end = m.end;
        this.now = 0;
        this.done = false;
        this.metaResolve?.(m.meta);
        this.metaResolve = this.metaReject = null;
        break;
      case 'events':
        this.busy = false;
        this.now = m.now;
        this.done = m.done;
        for (const l of this.listeners) l(m);
        break;
      case 'inspect':
        this.inspectResolve?.(m.data);
        this.inspectResolve = null;
        break;
      case 'metrics':
        this.metricsResolve?.(m.data);
        this.metricsResolve = null;
        break;
      case 'error':
        this.busy = false;
        if (this.metaReject) {
          this.metaReject(new Error(m.message));
          this.metaResolve = this.metaReject = null;
        } else {
          this.onError?.(m.message);
        }
        break;
    }
  }

  init(scenarioJson: string): Promise<SimMeta> {
    return new Promise((resolve, reject) => {
      this.metaResolve = resolve;
      this.metaReject = reject;
      this.send({ type: 'init', protocol: this.protocol, scenarioJson });
    });
  }

  onEvents(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Ask the worker to materialise events up to `toMicros`. No-op if a request is pending. */
  advance(toMicros: number): boolean {
    if (this.busy || this.done || toMicros <= this.now) return false;
    this.busy = true;
    this.send({ type: 'advance', toMicros: Math.min(toMicros, this.end) });
    return true;
  }

  step(): boolean {
    if (this.busy || this.done) return false;
    this.busy = true;
    this.send({ type: 'step' });
    return true;
  }

  /** Recreate the Sim and fast-forward. Safe to call while busy: the stale reply is ignored by callers via `reset` flag ordering. */
  reset(toMicros: number): void {
    this.busy = true;
    this.done = false;
    this.send({ type: 'reset', toMicros });
  }

  inspect(node: number): Promise<Inspect> {
    return new Promise((resolve) => {
      this.inspectResolve = resolve;
      this.send({ type: 'inspect', node });
    });
  }

  metrics(): Promise<Metrics> {
    return new Promise((resolve) => {
      this.metricsResolve = resolve;
      this.send({ type: 'metrics' });
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.listeners.clear();
  }
}

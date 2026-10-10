// The controller's view of a run's event source, independent of where the events come from.
//
// SimClient is backed by a wasm worker running sim-core. LiveClient is backed by the devnet
// RPC. Both satisfy this, which is what lets the timeline, the events feed and the
// transaction stepper render either without knowing which they are looking at.
import type { Inspect, Metrics, Protocol, SimMeta, Traced } from './types';

export interface EventsBatch {
  events: Traced[];
  now: number;
  done: boolean;
  reset: boolean;
}

export interface RunSource {
  readonly protocol: Protocol;
  /**
   * True for a source that observes a real cluster. The controller must not put these under
   * the clock clamp, the lookahead, or the backward-scrub re-create, all three of which assume
   * a deterministic Sim with a materialised future.
   */
  readonly live?: boolean;
  /** Latest sim time known to be materialised. */
  now: number;
  /** Declared horizon. A live run grows this to its newest observation instead. */
  end: number;
  done: boolean;
  meta: SimMeta | null;
  onError: ((msg: string) => void) | null;

  init(scenarioJson: string): Promise<SimMeta>;
  onEvents(l: (b: EventsBatch) => void): () => void;
  advance(toMicros: number): boolean;
  step(): boolean;
  reset(toMicros: number): void;
  inspect(node: number): Promise<Inspect | null>;
  metrics(): Promise<Metrics | null>;
  terminate(): void;
}
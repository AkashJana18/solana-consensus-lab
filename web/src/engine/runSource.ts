// The controller's view of a run's event source, independent of where the events come from.
//
// SimClient is backed by a wasm worker running sim-core, which is the only producer today.
// The interface stays abstract so the timeline, the events feed and the transaction stepper
// never learn where a run came from.
import type { Inspect, Metrics, Protocol, SimMeta, Traced } from './types';

export interface EventsBatch {
  events: Traced[];
  now: number;
  done: boolean;
  reset: boolean;
}

export interface RunSource {
  readonly protocol: Protocol;
  /** Latest sim time known to be materialised. */
  now: number;
  /** Declared horizon. */
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
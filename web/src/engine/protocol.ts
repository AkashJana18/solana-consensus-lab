// Main thread <-> worker message protocol.
import type { Inspect, Metrics, Protocol, SimMeta, Traced } from './types';

export type ToWorker =
  | { type: 'init'; protocol: Protocol; scenarioJson: string }
  | { type: 'advance'; toMicros: number }
  | { type: 'step' }
  | { type: 'inspect'; node: number }
  | { type: 'metrics' }
  /** Re-create the Sim (deterministic) and fast-forward to `toMicros`. */
  | { type: 'reset'; toMicros: number };

export type FromWorker =
  | { type: 'meta'; meta: SimMeta; end: number }
  | { type: 'events'; events: Traced[]; now: number; done: boolean; reset: boolean }
  | { type: 'inspect'; node: number; data: Inspect }
  | { type: 'metrics'; data: Metrics }
  | { type: 'error'; message: string };

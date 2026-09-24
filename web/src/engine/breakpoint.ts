// Declarative stop conditions for the display clock. A lesson step names a
// Trigger; the Controller compiles it to a predicate and halts the clock on the
// exact sim time of the first matching trace event (see Controller.setBreakpoint).
import type { RunView } from '../store/runView';
import type { CertKind, CommitmentLevel, PoolEventKind, Protocol, Traced, TxStage, VotorFlagKind } from './types';

export type Trigger =
  /** Stop at an absolute sim time (µs). Handled by the clock itself, no event needed. */
  | { type: 'time'; atUs: number }
  | { type: 'tx_stage'; stage: TxStage }
  | { type: 'certificate'; kind: CertKind | CertKind[]; minStake?: number }
  | { type: 'pool_event'; kind: PoolEventKind }
  | { type: 'votor_flag'; flag: VotorFlagKind }
  | { type: 'timeout' }
  | { type: 'node_offline' }
  | { type: 'node_online' }
  | { type: 'partition_start' }
  | { type: 'partition_end' }
  | { type: 'block_produced'; minVoteTxs?: number; withHeroTx?: boolean }
  | { type: 'tower_update'; minConfirmation: number }
  | { type: 'commitment'; level: CommitmentLevel }
  | { type: 'log'; pattern: RegExp };

/** Predicate over a trace event. `view` is the run's state *before* the event's batch is applied. */
export type Matcher = (e: Traced, view: RunView) => boolean;

export interface Breakpoint {
  /** Which run's buffer to watch (matters in compare mode). */
  protocol: Protocol;
  trigger: Trigger;
  /** If the trigger has not fired by this sim time (µs), stop there anyway and report `null`. */
  deadlineUs?: number;
}

export type HitCallback = (e: Traced | null, t: number) => void;

export function compileTrigger(tr: Trigger): Matcher {
  switch (tr.type) {
    case 'time':
      return () => false;
    case 'tx_stage':
      return (e) => e.type === 'tx_stage' && e.stage === tr.stage;
    case 'certificate': {
      const kinds = new Set(Array.isArray(tr.kind) ? tr.kind : [tr.kind]);
      const min = tr.minStake ?? 0;
      return (e) => e.type === 'certificate' && kinds.has(e.kind) && e.stake_pct >= min;
    }
    case 'pool_event':
      return (e) => e.type === 'pool_event' && e.kind === tr.kind;
    case 'votor_flag':
      return (e) => e.type === 'votor_flag' && e.flag === tr.flag;
    case 'timeout':
    case 'node_offline':
    case 'node_online':
    case 'partition_start':
    case 'partition_end':
      return (e) => e.type === tr.type;
    case 'block_produced':
      return (e) =>
        e.type === 'block_produced' &&
        (tr.minVoteTxs === undefined || (e.vote_txs ?? 0) >= tr.minVoteTxs) &&
        (!tr.withHeroTx || e.txs.includes(0));
    case 'tower_update':
      return (e) => e.type === 'tower_update' && e.lockouts.some((l) => l.confirmation_count >= tr.minConfirmation);
    case 'commitment':
      return (e) => e.type === 'commitment' && e.level === tr.level;
    case 'log':
      return (e) => e.type === 'log' && tr.pattern.test(e.msg);
  }
}

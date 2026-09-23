import { TX_STAGES, type Traced, type TxStage } from './types';

export interface StageHit {
  t: number;
  node?: number;
  slot?: number;
  detail?: string;
}

export type TxStageMap = Partial<Record<TxStage, StageHit>>;

/** Reduce trace events into the first-reached time per hero-tx stage. First occurrence wins. */
export function reduceTxStages(prev: TxStageMap, events: readonly Traced[]): TxStageMap {
  let next: TxStageMap | null = null;
  for (const e of events) {
    if (e.type !== 'tx_stage') continue;
    const cur = next ?? prev;
    if (cur[e.stage] !== undefined) continue;
    next = next ?? { ...prev };
    next[e.stage] = { t: e.t, node: e.node, slot: e.slot, detail: e.detail };
  }
  return next ?? prev;
}

/** Latency between two stages in microseconds, or null if either is missing. */
export function stageDelta(m: TxStageMap, from: TxStage, to: TxStage): number | null {
  const a = m[from];
  const b = m[to];
  return a && b ? b.t - a.t : null;
}

export const STAGE_LABEL: Record<TxStage, string> = {
  submitted: 'Submitted to RPC',
  forwarded_to_leader: 'Forwarded to leader',
  included_in_block: 'Included in block',
  propagating: 'Propagating',
  replayed: 'Replayed (supermajority)',
  voted: 'First vote',
  confirmed: 'Confirmed',
  finalized: 'Finalized',
};

export const STAGE_HINT: Record<TxStage, string> = {
  submitted: 'Client hands the tx to an RPC node.',
  forwarded_to_leader: 'Gulf Stream forwards it to the upcoming leader.',
  included_in_block: 'Leader places it in an entry / slice.',
  propagating: 'Shreds fan out via Turbine (Tower) or Rotor (Alpenglow).',
  replayed: '> 2/3 of stake has reconstructed and executed the block.',
  voted: 'First vote for the block containing the tx.',
  confirmed: 'Optimistic confirmation (Tower) / Notarization cert (Alpenglow).',
  finalized: 'Rooted by supermajority (Tower) / Finalization cert (Alpenglow).',
};

export { TX_STAGES };

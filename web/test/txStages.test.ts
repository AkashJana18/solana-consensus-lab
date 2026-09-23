import { describe, expect, it } from 'vitest';
import { reduceTxStages, stageDelta } from '../src/engine/txStages';
import type { Traced, TxStage } from '../src/engine/types';

const stage = (t: number, s: TxStage, node?: number): Traced => ({ t, type: 'tx_stage', tx: 0, stage: s, node });

describe('reduceTxStages', () => {
  it('records the first occurrence of each stage and ignores later repeats', () => {
    const m = reduceTxStages({}, [stage(250, 'submitted', 24), stage(400, 'included_in_block', 1), stage(715, 'replayed', 3), stage(720, 'replayed', 5), stage(730, 'replayed', 7)]);
    expect(m.submitted?.t).toBe(250);
    expect(m.submitted?.node).toBe(24);
    expect(m.replayed?.t).toBe(715);
    expect(m.replayed?.node).toBe(3);
    expect(m.finalized).toBeUndefined();
  });

  it('keeps earlier results across batches (first wins across calls too)', () => {
    const a = reduceTxStages({}, [stage(100, 'voted')]);
    const b = reduceTxStages(a, [stage(90, 'voted'), stage(200, 'confirmed')]);
    expect(b.voted?.t).toBe(100);
    expect(b.confirmed?.t).toBe(200);
  });

  it('returns the same object when nothing changes', () => {
    const a = reduceTxStages({}, [stage(1, 'submitted')]);
    const b = reduceTxStages(a, [stage(2, 'submitted'), { t: 3, type: 'log', msg: 'x' }]);
    expect(b).toBe(a);
  });

  it('ignores non tx_stage events', () => {
    expect(reduceTxStages({}, [{ t: 1, type: 'slot_start', slot: 0, leader: 1 }])).toEqual({});
  });
});

describe('stageDelta', () => {
  it('computes inclusion -> confirmed / finalized latencies', () => {
    const m = reduceTxStages({}, [stage(400_000, 'included_in_block'), stage(845_287, 'confirmed'), stage(854_896, 'finalized')]);
    expect(stageDelta(m, 'included_in_block', 'confirmed')).toBe(445_287);
    expect(stageDelta(m, 'included_in_block', 'finalized')).toBe(454_896);
    expect(stageDelta(m, 'included_in_block', 'replayed')).toBeNull();
  });
});

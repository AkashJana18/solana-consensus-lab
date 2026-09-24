import { describe, expect, it } from 'vitest';
import { compileTrigger } from '../src/engine/breakpoint';
import type { CertKind, Traced } from '../src/engine/types';
import { emptyView } from '../src/store/runView';

const view = emptyView('alpenglow');
const cert = (kind: CertKind, stake_pct = 0.7): Traced => ({ t: 1, type: 'certificate', node: 0, slot: 3, kind, stake_pct });
const stage = (s: 'submitted' | 'finalized'): Traced => ({ t: 1, type: 'tx_stage', tx: 0, stage: s });
const block = (vote_txs: number, txs: number[] = []): Traced => ({ t: 1, type: 'block_produced', slot: 2, hash: 5, parent: 0, leader: 1, txs, vote_txs });
const tower = (counts: number[]): Traced => ({ t: 1, type: 'tower_update', node: 2, lockouts: counts.map((c, i) => ({ slot: i, confirmation_count: c })) });
const log = (msg: string): Traced => ({ t: 1, type: 'log', node: 3, msg });

describe('compileTrigger', () => {
  it('never matches events for a time trigger (the clock handles it)', () => {
    expect(compileTrigger({ type: 'time', atUs: 5 })(stage('finalized'), view)).toBe(false);
  });

  it('matches tx stages by name', () => {
    const m = compileTrigger({ type: 'tx_stage', stage: 'finalized' });
    expect(m(stage('finalized'), view)).toBe(true);
    expect(m(stage('submitted'), view)).toBe(false);
  });

  it('matches certificates by one kind or several, with an optional stake floor', () => {
    expect(compileTrigger({ type: 'certificate', kind: 'skip' })(cert('skip'), view)).toBe(true);
    expect(compileTrigger({ type: 'certificate', kind: 'skip' })(cert('notarization'), view)).toBe(false);
    const either = compileTrigger({ type: 'certificate', kind: ['finalization', 'fast_finalization'] });
    expect(either(cert('finalization'), view)).toBe(true);
    expect(either(cert('fast_finalization'), view)).toBe(true);
    expect(either(cert('skip'), view)).toBe(false);
    expect(compileTrigger({ type: 'certificate', kind: 'notarization', minStake: 0.8 })(cert('notarization', 0.7), view)).toBe(false);
  });

  it('matches bare event types', () => {
    expect(compileTrigger({ type: 'partition_end' })({ t: 1, type: 'partition_end' }, view)).toBe(true);
    expect(compileTrigger({ type: 'timeout' })({ t: 1, type: 'timeout', node: 1, slot: 4 }, view)).toBe(true);
    expect(compileTrigger({ type: 'node_offline' })({ t: 1, type: 'node_online', node: 1 }, view)).toBe(false);
  });

  it('matches blocks by vote-tx count and hero inclusion', () => {
    expect(compileTrigger({ type: 'block_produced', minVoteTxs: 1 })(block(0), view)).toBe(false);
    expect(compileTrigger({ type: 'block_produced', minVoteTxs: 1 })(block(7), view)).toBe(true);
    expect(compileTrigger({ type: 'block_produced', withHeroTx: true })(block(0, [3, 0]), view)).toBe(true);
    expect(compileTrigger({ type: 'block_produced', withHeroTx: true })(block(0, [3]), view)).toBe(false);
    expect(compileTrigger({ type: 'block_produced' })(block(0), view)).toBe(true);
  });

  it('matches tower updates once any lockout reaches the confirmation count', () => {
    const m = compileTrigger({ type: 'tower_update', minConfirmation: 8 });
    expect(m(tower([1, 2, 3]), view)).toBe(false);
    expect(m(tower([9, 2, 1]), view)).toBe(true);
  });

  it('matches log messages by pattern', () => {
    const m = compileTrigger({ type: 'log', pattern: /locked out/ });
    expect(m(log('slot 9: locked out (a tower vote on another fork has not expired)'), view)).toBe(true);
    expect(m(log('tx 0 not seen in a block yet'), view)).toBe(false);
  });
});

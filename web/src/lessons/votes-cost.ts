import { fmtBytes, fmtInt } from '../util/format';
import type { Lesson } from './types';

/** Lesson 2: TowerBFT votes are transactions in blocks; Alpenglow votes never touch the ledger. */
export const votesCost: Lesson = {
  id: 'votes-cost',
  title: 'Why votes on-chain cost block space',
  summary: 'TowerBFT validators vote by sending transactions to the leader. See how much block space that consumes, and why Alpenglow blocks carry zero votes.',
  minutes: 3,
  scenario: 'happy-path',
  mode: 'compare',
  seed: 1,
  speed: 5,
  intro: `On mainnet today roughly **three quarters of all transactions are votes**. This lesson shows why.

Under **TowerBFT** a validator votes by building a *vote transaction* (about 300 bytes) and sending it to the current leader, exactly like a user transaction. The leader packs it into the next block; only once the block is replayed does everyone count the vote.

Under **Alpenglow** a vote is a small packet (about 150 bytes) sent **directly to every validator**. It is never placed in a block.

Press **Start**.`,
  steps: [
    {
      id: 'first-votes-packed',
      title: 'A TowerBFT block packs vote transactions',
      protocol: 'tower',
      trigger: { type: 'log', pattern: /vote txs .* packed/ },
      tab: 'events',
      body: (hit) => `The leader just reported: **${hit && hit.type === 'log' ? hit.msg : 'vote transactions packed alongside user transactions'}**.

Those votes were cast for the *previous* block; the leader had to wait for them to arrive at its TPU, then spend block space on them. Every validator in the cluster does this every slot, so at 25 validators a block carries up to 25 vote transactions before any user transaction.

Colour key: **teal** particles heading to the leader are vote transactions; under Alpenglow (left) the teal particles fan out to *everyone* instead.`,
    },
    {
      id: 'count-votes',
      title: 'How many votes per run?',
      protocol: 'tower',
      trigger: { type: 'time', atUs: 8_000_000 },
      tab: 'metrics',
      lead: `The **Metrics** tab has a row "vote txs in blocks" for TowerBFT. We will run to the 8 s mark, half of this 16 s scenario. Predict first.`,
      question: {
        prompt: 'With 25 validators voting once per 400 ms slot, about how many vote transactions land in blocks over the full 16 s run?',
        choices: ['About 25', 'About 100', 'About 400', 'About 4000'],
        answer: 2,
        explain: `25 validators × one vote per slot × 40 slots ≈ 1000 votes cast, but each block only carries the votes that reached the leader in time, and votes for skipped or late blocks are dropped, so roughly **400** land. On mainnet with ~1300 validators this is the majority of all transactions.`,
      },
      body: (_hit, view) => {
        const m = view.metrics;
        const n = m?.vote_txs_in_blocks ?? 0;
        const bytes = m?.vote_tx_bytes_in_blocks ?? 0;
        return `At 8 s the TowerBFT chain has packed **${fmtInt(n)} vote transactions** into blocks, **${fmtBytes(bytes)}** of block space (see *vote txs in blocks* in the Metrics tab). The full 16 s run ends near 400.

Those bytes are paid for by validators as transaction fees, they consume block compute budget, and they must be shred, propagated and replayed by every node just like user transactions.`;
      },
    },
    {
      id: 'alpenglow-zero',
      title: 'An Alpenglow block carries no votes',
      protocol: 'alpenglow',
      trigger: { type: 'block_produced' },
      tab: 'metrics',
      body: (hit) => `The Alpenglow leader just produced block for slot **${hit && hit.type === 'block_produced' ? hit.slot : '?'}** with **${hit && hit.type === 'block_produced' ? hit.vote_txs : 0} vote transactions**. It will always be zero.

Alpenglow votes travel validator-to-validator; whoever sees 60% (or 80%) of stake aggregates them into a **certificate** and broadcasts it once. The Metrics tab shows the trade-off: more small **vote** messages on the wire, zero bytes of block space, and no dependence on the leader to include your vote.`,
    },
  ],
  outro: `## What you saw

- TowerBFT votes are **transactions**: they wait for the leader, cost block space and fees, and are counted only after replay.
- Alpenglow votes are **messages**: broadcast directly, aggregated into certificates, never in a block.
- The Metrics row *vote txs in blocks* quantifies the cost for any scenario you load.

## Try next

- Switch the scenario to **offline-25pct** and compare the vote counts.
- Lesson **Skip certificates** shows what Alpenglow does when the leader is missing.`,
};

import { STAGE_HINT } from '../engine/txStages';
import { fmtMs } from '../util/format';
import type { Lesson } from './types';

/** Lesson 1: follow the hero transaction through both protocols side by side. */
export const oneTx: Lesson = {
  id: 'one-tx',
  title: 'One transaction, two protocols',
  summary: 'Follow a single transaction from the RPC node to finality under TowerBFT and Alpenglow at the same time.',
  minutes: 4,
  scenario: 'happy-path',
  mode: 'compare',
  seed: 1,
  speed: 5,
  intro: `Both simulations run the **same** 25 validators, the same stake distribution, the same network latencies and the same seed. The only thing that differs is the consensus protocol.

We follow one transaction (the white glow) through eight stages. The **Transaction** tab on the right keeps score for both protocols.

- Left canvas: **Alpenglow** (Votor + Rotor, SIMD-0326).
- Right canvas: **TowerBFT** (PoH + Turbine + tower lockouts, today's mainnet).

Press **Start**. The simulation pauses at each stop.`,
  steps: [
    {
      id: 'submitted',
      title: 'Submitted to an RPC node',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'submitted' },
      body: `The client hands the transaction to an RPC node (the red diamond). Solana has **no mempool**: the RPC node forwards it straight to the upcoming leader (**Gulf Stream**), and keeps re-forwarding every slot until the transaction appears in a block.

This part is identical in both protocols. The interesting differences start once the leader has the transaction.`,
    },
    {
      id: 'included',
      title: 'Included in a block',
      protocol: 'tower',
      trigger: { type: 'tx_stage', stage: 'included_in_block' },
      body: `The leader packs the transaction into its block. Under **TowerBFT** the leader starts each 400 ms slot on its own **Proof of History** clock. Under **Alpenglow** there is no PoH: the leader starts a slot when its Pool reports that the parent is ready (\`ParentReady\`) and then paces slices by Δblock.

Watch the shreds fan out: **Turbine** (right) relays through a stake-weighted tree, **Rotor** (left) uses a single hop through stake-weighted relays.

${STAGE_HINT.included_in_block}`,
    },
    {
      id: 'confirmed',
      title: 'First to "confirmed"',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'confirmed' },
      lead: `Both protocols will report the transaction as **confirmed** and later as **finalized**. Predict the ordering, then run.`,
      question: {
        prompt: 'Which protocol reaches "confirmed" first, and which reaches "finalized" first?',
        choices: ['Alpenglow reaches both first', 'TowerBFT reaches both first', 'TowerBFT confirms first, Alpenglow finalizes first', 'They tie on both'],
        answer: 0,
        explain: `**Confirmed** means different things: Alpenglow forms a **Notarization certificate** as soon as 60% of stake has sent a Notarize vote directly to everyone. TowerBFT needs vote *transactions* to land in a later block and be replayed before ⅔ of stake counts as voting for the block, so it lags by a slot or so. On finality the gap is not a slot but two orders of magnitude.`,
      },
      body: (hit) => `Alpenglow just reached **confirmed** at ${fmtMs(hit?.t)}: 60% of the stake sent a Notarize vote for the block, and a validator aggregated them into a **Notarization certificate**.

Keep an eye on the TowerBFT column: its optimistic confirmation arrives once ⅔ of stake has voted on the block or a descendant.`,
    },
    {
      id: 'finalized-alpenglow',
      title: 'Alpenglow finalizes',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'finalized' },
      body: (hit, view) => {
        const inc = view.txStages.included_in_block?.t;
        const fin = hit?.t;
        const delta = inc !== undefined && fin !== undefined ? fmtMs(fin - inc) : '—';
        return `**Fast path.** Notarize votes kept arriving after the 60% mark; at 80% the same votes double as a **Fast-Finalization certificate**. No second voting round was needed.

From inclusion to finality: **${delta}**. If fewer than 80% had been online, Alpenglow would have fallen back to the slow path: a Finalize vote round after notarization, finalizing at 60% + 60%.

${STAGE_HINT.finalized}`;
      },
    },
    {
      id: 'confirmed-tower',
      title: 'TowerBFT confirms',
      protocol: 'tower',
      trigger: { type: 'tx_stage', stage: 'confirmed' },
      tab: 'tower',
      body: `TowerBFT's **optimistic confirmation**: ≥ ⅔ of stake has its latest vote on this block or one of its descendants. Wallets and RPC nodes treat this as the \`confirmed\` commitment level.

But the vote is not final yet. Every validator's vote sits in a **tower** of lockouts (see the Tower tab). The block only becomes the validator's **root** once 31 more votes have stacked on top of it.`,
    },
    {
      id: 'finalized-tower',
      title: 'TowerBFT roots the block',
      protocol: 'tower',
      trigger: { type: 'tx_stage', stage: 'finalized' },
      lead: `Alpenglow is already final. TowerBFT is still stacking votes. Predict how long finality takes, then run.`,
      question: {
        prompt: 'How long after the block is produced does TowerBFT root it (the "finalized" commitment level)?',
        choices: ['About 0.5 s', 'About 2 s', 'About 13 s', 'About 60 s'],
        answer: 2,
        explain: `A vote's lockout doubles with every vote stacked on top of it. Agave keeps 31 lockouts; the 32nd vote pops the oldest one and it becomes the **root**. 32 slots × 400 ms ≈ 12.8 s of votes must land before the block is final, plus network time.`,
      },
      body: (hit, view) => {
        const inc = view.txStages.included_in_block?.t;
        const fin = hit?.t;
        const delta = inc !== undefined && fin !== undefined ? fmtMs(fin - inc, 0) : '—';
        return `Rooted. From inclusion to root: **${delta}**.

This is the number that matters for exchanges, bridges and anything that waits for \`finalized\`: **~12.8 s** under TowerBFT versus **well under a second** under Alpenglow, on the same network with the same validators.`;
      },
    },
  ],
  outro: `## What you saw

- Same transaction, same network, same stake: **confirmed** arrives at a similar time in both protocols, **finalized** does not.
- Alpenglow finalizes with certificates formed from votes sent **directly** between validators (fast path at 80%, slow path at 60% + 60%).
- TowerBFT finalizes when a vote is **31 lockouts deep**, about 12.8 s later.

## Try next

- Open the **Metrics** tab and compare message counts and bytes.
- Change the seed in the top bar and run again: the shape stays the same, the exact milliseconds move.
- Lesson **Why votes on-chain cost block space** shows where TowerBFT's votes go.`,
};

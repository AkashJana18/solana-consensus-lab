import { fmtMs } from '../util/format';
import type { Lesson } from './types';

/** Lesson 4: a 50/50 partition stalls both protocols; TowerBFT's lockouts make the recovery slow. */
export const lockouts: Lesson = {
  id: 'lockouts',
  title: 'Lockouts and why partitions hurt TowerBFT',
  summary: 'A 50/50 network partition. Both protocols stall safely; after the heal Alpenglow finalizes in under a second while TowerBFT needs its tower of lockouts to grow past the gap.',
  minutes: 5,
  scenario: 'partition-heal',
  mode: 'compare',
  seed: 1,
  speed: 2,
  intro: `At **1.5 s** the network splits into two halves of roughly equal stake for 1.2 s. Our transaction is submitted at 1.8 s, in the middle of the partition, to an RPC node on one side.

Two questions matter for a consensus protocol here:

- **Safety**: can the two halves finalize *different* blocks for the same slot? (They must not.)
- **Liveness**: how quickly does finality resume after the heal?

TowerBFT answers the first question with **lockouts**: once a validator votes for a block, it may not vote for a conflicting fork until the lockout (2, 4, 8, … slots) expires. That is what makes TowerBFT slow to recover.

Press **Start**.`,
  steps: [
    {
      id: 'split',
      title: 'The network splits',
      protocol: 'tower',
      trigger: { type: 'partition_start' },
      body: (hit) => {
        const groups = hit && hit.type === 'partition_start' ? hit.groups : [];
        return `Partition: **${groups.map((g) => g.length).join(' and ')} validators**, about half the stake each. Messages across the divider are dropped (particles fizzle at the line).

Neither half holds 60% of the stake, so under Alpenglow no Notarization or Skip certificate can form. Neither half holds ⅔, so under TowerBFT no block can be optimistically confirmed. Both protocols are about to stall, which is the **safe** outcome.`;
      },
    },
    {
      id: 'stuck',
      title: 'Gulf Stream keeps retrying',
      protocol: 'tower',
      trigger: { type: 'log', pattern: /not seen in a block yet/ },
      tab: 'events',
      lead: `The transaction is submitted at 1.8 s to an RPC node on one side of the divider. The current leader is on the other side. Predict what happens.`,
      question: {
        prompt: 'While the partition lasts, does either protocol finalize anything?',
        choices: ['Both halves finalize their own blocks', 'Only Alpenglow finalizes', 'Only TowerBFT finalizes', 'Neither: both stall until the heal'],
        answer: 3,
        explain: `Both protocols need a supermajority of **total** stake: 60% (Alpenglow) or ⅔ (TowerBFT). A half cannot reach either, so nothing finalizes and, crucially, nothing *conflicting* finalizes. Stalling is the price of safety.`,
      },
      body: (hit) => `The RPC node reports: **${hit && hit.type === 'log' ? hit.msg : 'tx not seen in a block yet'}**. Its forwards to the leader are dropped at the divider, so it re-forwards every slot. Under Alpenglow the same thing happens.

Meanwhile TowerBFT validators on each side keep voting on their own side's blocks. Each of those votes **locks them in**: a vote on slot *s* with confirmation count *c* forbids voting on another fork for 2^c slots.`,
    },
    {
      id: 'heal',
      title: 'The partition heals',
      protocol: 'tower',
      trigger: { type: 'partition_end' },
      tab: 'tower',
      body: `The divider is gone. Now each protocol has to reconcile what the two halves did.

**Alpenglow**: nobody voted Notarize for blocks they never saw, and the timeouts have already made validators vote **Skip** on the stalled slots. The window is closed with Skip certificates and the next leader starts from a clean **ParentReady**.

**TowerBFT**: validators hold votes for two different forks. The heavier fork wins (heaviest-subtree fork choice), but validators locked on the lighter fork must **wait for their lockouts to expire** before they can vote on the winner.`,
    },
    {
      id: 'alpenglow-skip',
      title: 'Alpenglow skips the stalled window',
      protocol: 'alpenglow',
      trigger: { type: 'certificate', kind: 'skip' },
      deadlineUs: 4_000_000,
      tab: 'votor',
      selectNode: 'hit',
      body: (hit) =>
        hit && hit.type === 'certificate'
          ? `A **Skip certificate** for slot ${hit.slot} at ${fmtMs(hit.t)} closes the slot that stalled during the split.

Look at the Events tab just before it: a **standstill** line. Votes cast during the partition never crossed the divider, so after the heal every validator had voted and nobody could form a certificate. A node that sees no finalization for Δstandstill (1 s in this scenario) re-broadcasts its votes and certificates; the moment they land, the Skip and fallback votes from both sides add up and the certificate forms. The next leader gets **ParentReady** and our transaction, still in Gulf Stream, lands in its first block.`
          : `At this seed no Skip certificate was needed after the heal. Usually the stalled window is closed with Skip certificates so the next leader can start.`,
    },
    {
      id: 'alpenglow-final',
      title: 'Alpenglow finalizes',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'finalized' },
      tab: 'transaction',
      body: (hit, view) => {
        const heal = 2_700_000;
        const after = hit ? fmtMs(hit.t - heal, 0) : '—';
        const inc = view.txStages.included_in_block?.t;
        return `Finalized at ${fmtMs(hit?.t)}: **${after} after the heal**. The transaction was included at ${fmtMs(inc)} by the first leader with a clean ParentReady and reached the fast path at 80% within half a second.

Alpenglow has no lockouts to wait out: a validator that voted Skip or Notarize during the partition is free to vote in the next window because every slot is decided by *certificates*, not by a personal history of votes. Most of the recovery time here is the standstill timer, not consensus.`;
      },
    },
    {
      id: 'tower-depth',
      title: 'TowerBFT: a vote reaches depth 8',
      protocol: 'tower',
      trigger: { type: 'tower_update', minConfirmation: 8 },
      tab: 'tower',
      selectNode: 'hit',
      body: (hit) => {
        const top = hit && hit.type === 'tower_update' ? hit.lockouts.find((l) => l.confirmation_count >= 8) : undefined;
        return `Node ${hit && 'node' in hit ? hit.node : '?'}'s tower now has a vote on slot **${top?.slot ?? '?'}** with confirmation count **${top?.confirmation_count ?? 8}**: its lockout is 2^${top?.confirmation_count ?? 8} = **${top ? 2 ** top.confirmation_count : 256} slots**.

This is also the **threshold check**: before voting, a validator checks that the vote which would sit at depth 8 already has ⅔ of the stake behind it. During a partition that check fails on the minority side, which is another reason TowerBFT halts rather than forks.`;
      },
    },
    {
      id: 'tower-final',
      title: 'TowerBFT finalizes',
      protocol: 'tower',
      trigger: { type: 'tx_stage', stage: 'finalized' },
      tab: 'transaction',
      body: (hit, view) => {
        const inc = view.txStages.included_in_block?.t;
        const delta = inc !== undefined && hit ? fmtMs(hit.t - inc, 0) : '—';
        return `Rooted at ${fmtMs(hit?.t, 0)}, **${delta}** after inclusion. The block only became final once 31 more votes stacked on top of it; every one of those votes had to clear the lockout and threshold checks that the partition disturbed.

Compare the two Finalized rows in the Transaction tab: the partition cost both protocols about a second of stall, but only TowerBFT pays the extra ~12.8 s afterwards.`;
      },
    },
  ],
  outro: `## What you saw

- A 50/50 partition **stalls both protocols**; neither finalizes conflicting blocks. Safety held.
- Alpenglow recovers with **Skip certificates** and a fresh ParentReady: finality resumes about a second after the heal.
- TowerBFT recovers through **lockouts** and the depth-8 **threshold check**; finality resumes only when the tower is 31 votes deep again.
- A transaction stuck in a skipped block is **re-forwarded** by its RPC node; on mainnet your wallet's retry logic does the same.

## Try next

- Change the partition to \`"stake_split": [0.3, 0.7]\` in a custom scenario: the 70% side keeps finalizing under both protocols and the 30% side catches up after the heal.
- Lesson **20+20** looks at Alpenglow's resilience budget: 20% offline plus 20% adversarial.`,
};

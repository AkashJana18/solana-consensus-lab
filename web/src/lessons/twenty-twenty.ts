import { fmtMs } from '../util/format';
import type { Lesson } from './types';

/** Lesson 5: Alpenglow's 20+20 resilience budget, offline arm. */
export const twentyTwenty: Lesson = {
  id: 'twenty-twenty',
  title: '20+20',
  summary: "Alpenglow tolerates 20% adversarial stake plus 20% offline stake. This lesson takes the offline arm: a fifth of the stake is dark, then the network splits. What still finalizes, and how does the cluster recover?",
  minutes: 5,
  scenario: 'twenty-twenty',
  mode: 'alpenglow',
  seed: 1,
  speed: 2,
  intro: `Alpenglow's headline resilience claim is **20+20**: safety holds with up to 20% of stake behaving adversarially, and liveness holds with a further 20% simply offline.

The numbers come straight from the thresholds. The **fast path** needs 80% Notarize votes; with 20% offline it is out of reach. The **slow path** needs 60% Notarize and then 60% Finalize votes; 80% online stake clears it comfortably. Two conflicting 60% certificates would need at least 20% of stake to vote twice, which is the adversarial budget.

In this scenario just over a fifth of the stake is offline from the start. At **4.0 s** the online validators are split in two for 1.5 s.

This build has no adversarial behaviour yet (that is the attack lab, milestone 4), so we look at the **offline** arm only.

Press **Start**.`,
  steps: [
    {
      id: 'offline',
      title: 'A fifth of the stake never shows up',
      protocol: 'alpenglow',
      trigger: { type: 'node_offline' },
      tab: 'metrics',
      body: (_hit, view) => {
        const offline = [...view.offline].sort((a, b) => a - b);
        return `Nodes **${offline.join(', ')}** are offline (dimmed) for the whole run: about 21% of the stake. The remaining 79% is enough for every 60% threshold and never enough for the 80% one.

Watch the certificates that form in the next second.`;
      },
    },
    {
      id: 'slow-path',
      title: 'Which certificate finalizes?',
      protocol: 'alpenglow',
      trigger: { type: 'certificate', kind: ['fast_finalization', 'finalization'] },
      tab: 'votor',
      selectNode: 'hit',
      lead: `The first block is being produced. Predict how it will be finalized.`,
      question: {
        prompt: 'With 79% of the stake online, how does the first block get finalized?',
        choices: [
          'Fast path: an 80% Fast-Finalization certificate',
          'Slow path: a 60% Notarization certificate, then a 60% Finalization certificate',
          'It cannot be finalized while 21% is offline',
          'It depends on which validators are offline',
        ],
        answer: 1,
        explain: `The fast path needs **80% of all stake** to vote Notarize; only 79% can. The block is still notarized at 60%, every validator that voted Notarize then casts a **Finalize** vote, and at 60% Finalize votes a **Finalization certificate** forms. One extra round trip, roughly 100 ms, and finality is reached.`,
      },
      body: (hit) =>
        hit && hit.type === 'certificate'
          ? `A **${hit.kind === 'fast_finalization' ? 'Fast-Finalization' : 'Finalization'} certificate** for slot ${hit.slot} at ${fmtMs(hit.t)} with ${Math.round(hit.stake_pct * 100)}% of stake. ${
              hit.kind === 'finalization'
                ? 'The Votor tab shows the selected node with `ItsOver` set for this slot: it saw the block notarized, voted Finalize, and is done with the slot.'
                : 'At this seed the offline set was small enough for the fast path; try another seed to see the slow path.'
            }`
          : 'No finality certificate formed.',
    },
    {
      id: 'split',
      title: 'The second 20: a partition',
      protocol: 'alpenglow',
      trigger: { type: 'partition_start' },
      body: (hit) => `Partition: **${hit && hit.type === 'partition_start' ? hit.groups.map((g) => g.length).join(' and ') : '?'} validators** can no longer talk to each other. Each side now holds well under 60% of the *total* stake, because the offline 21% counts against both.

Nothing can be notarized, skipped or finalized on either side. This is safety doing its job: a supermajority of total stake is required, and neither half has one.`,
    },
    {
      id: 'safe-to-skip',
      title: 'SafeToSkip fires',
      protocol: 'alpenglow',
      trigger: { type: 'pool_event', kind: 'safe_to_skip' },
      deadlineUs: 5_500_000,
      tab: 'votor',
      selectNode: 'hit',
      body: (hit) =>
        hit && hit.type === 'pool_event'
          ? `Node ${hit.node} reports **SafeToSkip** for slot ${hit.slot}: it has already voted in this slot, and it now sees at least 40% of stake either voting Skip or Notarize for a *different* block than its own. It casts a **SkipFallback** vote and marks the window as \`BadWindow\`.

The fallback votes exist so that a slot where the stake is split can still be closed with a certificate once messages flow again. Right now they cannot cross the divider.`
          : `At this seed no SafeToSkip fired during the partition. It appears when a node that already voted sees 40% of stake disagreeing with its vote.`,
    },
    {
      id: 'standstill',
      title: 'Standstill recovery',
      protocol: 'alpenglow',
      trigger: { type: 'log', pattern: /standstill/ },
      deadlineUs: 8_000_000,
      tab: 'events',
      body: (hit) =>
        hit && hit.type === 'log'
          ? `Node ${hit.node}: **${hit.msg}**.

A validator that has seen no new finalization for Δstandstill (1 s in this scenario, longer on mainnet) re-broadcasts its own votes and every certificate it holds since the last finalized slot. Votes cast during a partition never reached the other side; without this re-broadcast the cluster could deadlock after the heal, with everyone having voted and nobody able to form a certificate.`
          : 'No standstill re-broadcast was needed at this seed.',
    },
    {
      id: 'heal',
      title: 'The partition heals',
      protocol: 'alpenglow',
      trigger: { type: 'partition_end' },
      body: `The divider is gone. Certificates and votes from the next standstill burst now reach everyone, Skip certificates close the stalled slots, the next leader gets **ParentReady**, and finalization resumes.

Some windows after the heal still get skipped: their leaders are among the offline validators, and the stake-weighted leader schedule does not know that.`,
    },
    {
      id: 'resume',
      title: 'Finality resumes',
      protocol: 'alpenglow',
      trigger: { type: 'certificate', kind: ['fast_finalization', 'finalization'] },
      tab: 'transaction',
      body: (hit) => `A finality certificate for slot **${hit && hit.type === 'certificate' ? hit.slot : '?'}** at ${fmtMs(hit?.t)}: liveness is back, about ${hit ? fmtMs(hit.t - 5_500_000, 0) : '—'} after the heal.

Throughout the whole run no slot ever received two conflicting certificates. That is the 20 (adversarial) arm of 20+20 holding trivially here, because nobody misbehaved. The attack lab will put a double-voting 20% against it.`,
    },
  ],
  outro: `## What you saw

- **21% offline**: the fast path (80%) is gone, the slow path (60% + 60%) finalizes about 100 ms later than the fast path would.
- **A partition on top**: neither side has 60% of total stake, so everything stalls safely; **SafeToSkip** and fallback votes prepare the cleanup.
- **Standstill recovery** re-broadcasts votes and certificates so a healed cluster can actually use what each side voted during the split.
- Windows led by offline validators keep getting **skipped** after the heal; that is the cost of liveness with dark stake.

## Try next

- Paste the scenario as custom JSON and set the offline \`stake_pct\` to 0.35: the slow path fails too and only Skip certificates form.
- Compare the same scenario under **TowerBFT** (Compare mode): with 21% offline it still confirms but roots even later.`,
};

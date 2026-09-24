import { fmtMs } from '../util/format';
import type { Lesson } from './types';

/** Lesson 3: a leader goes offline; Alpenglow closes its slots with Skip certificates. */
export const skipCerts: Lesson = {
  id: 'skip-certs',
  title: 'Skip certificates',
  summary: 'A leader goes dark in the middle of its window. Watch validators time out, vote Skip, and close the slots with certificates so the chain can move on.',
  minutes: 4,
  scenario: 'leader-down',
  mode: 'alpenglow',
  seed: 1,
  speed: 1,
  intro: `In this scenario the validator that leads slots 4–7 goes **offline at 1.0 s** and stays down until 5.0 s. Because it also holds a lot of stake, it happens to lead the first window too, so its outage starts during slots 0–3.

Alpenglow has no global clock to tell everyone "the slot is over". Instead each validator runs a local **timeout** per slot, set when the window's parent became ready: Δtimeout (900 ms) plus one Δblock (400 ms) for each later slot in the window.

Press **Start**.`,
  steps: [
    {
      id: 'offline',
      title: 'The leader goes offline',
      protocol: 'alpenglow',
      trigger: { type: 'node_offline' },
      selectNode: 'hit',
      body: (hit) => `Node **${hit && hit.type === 'node_offline' ? hit.node : '?'}** is now offline (dimmed). It is the leader of the current window and of slots 4–7. No more shreds will come from it, so no validator can complete or vote Notarize on its next blocks.

Nothing visible happens for a while: the other validators are simply **waiting**, with their timeouts ticking.`,
    },
    {
      id: 'skip-cert',
      title: 'The first Skip certificate',
      protocol: 'alpenglow',
      trigger: { type: 'certificate', kind: 'skip' },
      tab: 'votor',
      selectNode: 'hit',
      lead: `Validators' timeouts for the dead leader's slots are about to fire. Predict what happens to those slots.`,
      question: {
        prompt: 'The leader is offline for slots 2 and 3 of its window. What happens to those slots?',
        choices: [
          'The chain halts until the leader comes back at 5 s',
          'Validators time out, vote Skip, and a 60% Skip certificate closes each slot',
          'The next leader takes over immediately and produces the missing blocks',
          'Two forks form and the heavier one wins later',
        ],
        answer: 1,
        explain: `When a timeout fires for a slot the validator has not voted in, Votor runs \`TrySkipWindow\`: it votes **Skip** for every remaining slot of the window and sets the \`BadWindow\` flag. Once 60% of stake has voted Skip (or SkipFallback), anyone can form a **Skip certificate**. An empty slot is now final, and the chain can move on without the leader.`,
      },
      body: (hit) => `A **Skip certificate** for slot **${hit && hit.type === 'certificate' ? hit.slot : '?'}** formed at ${fmtMs(hit?.t)} with ${hit && hit.type === 'certificate' ? Math.round(hit.stake_pct * 100) : '?'}% of stake. Look at the **Votor** tab for the selected node: the slot shows \`Voted\` and \`BadWindow\`, and the Pool tally shows the Skip bar crossing the 60% line.

Notice how *fast* this was once the timeouts fired: one round of votes, one certificate, no leader involved.`,
    },
    {
      id: 'parent-ready',
      title: 'ParentReady for the next window',
      protocol: 'alpenglow',
      trigger: { type: 'pool_event', kind: 'parent_ready' },
      tab: 'votor',
      body: (hit) => `The Pool now reports **ParentReady** for slot **${hit && hit.type === 'pool_event' ? hit.slot : '?'}**: the last notarized block plus Skip certificates for every slot in between means the next leader knows exactly which parent to build on.

The next window's leader is the *same* offline validator, so its slots 4–7 will be skipped the same way: timeouts, Skip votes, Skip certificates. The window after that has a live leader.`,
    },
    {
      id: 'included',
      title: 'The hero transaction lands',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'included_in_block' },
      tab: 'transaction',
      body: (hit) => `Our transaction was submitted at 1.7 s, straight into the dead window. Gulf Stream kept forwarding it to the current and next leaders; the first **live** leader included it in slot **${hit && hit.type === 'tx_stage' ? hit.slot : '?'}** at ${fmtMs(hit?.t)}.

The delay the user experienced is almost entirely the skipped windows. The consensus rounds that follow are as fast as in the happy path.`,
    },
    {
      id: 'finalized',
      title: 'Finalized',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'finalized' },
      tab: 'transaction',
      body: (hit, view) => {
        const inc = view.txStages.included_in_block?.t;
        const delta = inc !== undefined && hit ? fmtMs(hit.t - inc) : '—';
        return `Finalized at ${fmtMs(hit?.t)}, **${delta}** after inclusion. The leader outage cost the user waiting time, but never safety: no slot ever received two conflicting certificates, and the skipped slots are final as *empty*.

Compare with TowerBFT: switch to **Compare** mode with this scenario after the lesson and watch the same outage produce a 12.8 s wait for finality on top of the skipped slots.`;
      },
    },
  ],
  outro: `## What you saw

- Alpenglow validators use **local timeouts**, not a global clock, to decide a slot is dead.
- A timeout triggers **Skip votes for the rest of the window**; 60% of stake makes a **Skip certificate** and the empty slot is final.
- **ParentReady** tells the next leader what to build on: notarized parent + Skip certificates for every slot between.

## Try next

- Paste the scenario as custom JSON and lower \`params.alpenglow.timeout_ms\` below 700: healthy leaders start getting skipped, because a block is only voted on once all of its slices have arrived.
- Lesson **Lockouts and why partitions hurt TowerBFT** looks at a fault that stalls both protocols.`,
};

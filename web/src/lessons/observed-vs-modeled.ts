import { fmtMs } from '../util/format';
import type { Lesson } from './types';

/**
 * Lesson 6: what devnet shows you, and what it refuses to show you.
 *
 * This one runs the `devnet-shape` scenario rather than a hand-built fault, because the point
 * is that the shape was measured. Two numbers were checked against api.devnet.solana.com on
 * 7 Oct 2026 and only two: a slot every ~250 ms, and a block in all 1,989 slots sampled. Both
 * are parameters here, which is the honest form of "this looks like devnet": the scenario
 * takes devnet's shape, not devnet's behaviour.
 */
export const observedVsModeled: Lesson = {
  id: 'observed-vs-modeled',
  title: 'Observed vs modeled',
  summary:
    'A run shaped like devnet from measurements taken against the real cluster. Compare what an outside observer can see with what the model insists happened inside, and find the boundary between them.',
  minutes: 4,
  scenario: 'devnet-shape',
  mode: 'alpenglow',
  seed: 1,
  speed: 1,
  intro: `Everything else in this app is a model. This lesson starts from a **measurement** instead.

On 7 Oct 2026 two things were checked against \`api.devnet.solana.com\`, and only two:

- devnet runs a slot every **~250 ms**, measured three ways (repeated \`getSlot\` sampling, the \`blockTime\` of slots 20 apart, and the cadence this app measures while watching)
- across **1,989 sampled slots** there was not one slot without a block, so no **Skip certificate** was externally visible at that time

This scenario sets \`slot_ms\` to 250 and takes no faults off, which is what "a block in every slot" looks like. **It is not a replica of devnet.** The moment devnet skips a slot or slows down, this scenario is wrong, and comparing the two is the lesson.

Press **Start**.`,
  steps: [
    {
      id: 'first-block',
      title: 'A block in every slot',
      protocol: 'alpenglow',
      trigger: { type: 'block_produced' },
      selectNode: 'hit',
      body: (hit) => `Slot **${hit && hit.type === 'block_produced' ? hit.slot : '?'}** produced a block, and so will every slot after it: no slot in this run is left empty. That is the first measured fact reproduced.

On the real cluster this is what an observer sees, and it is genuinely informative. A slot with **no** block is visible from outside too, and is the shadow of a Skip certificate. This run simply has none, because the measurement said devnet had none on the day.

A modeling choice worth naming: I did not invent a skip to make the demo more interesting. A scenario that skipped slots would model a devnet that was not observed.`,
    },
    {
      id: 'notarize',
      title: 'A vote the cluster cannot show you',
      protocol: 'alpenglow',
      trigger: { type: 'pool_event', kind: 'block_notarized' },
      tab: 'votor',
      selectNode: 'hit',
      lead: `This validator just cast a Notarize vote for the block. Predict what an outside observer would have seen at this exact moment on the real devnet.`,
      question: {
        prompt: 'A validator casts a Notarize vote. What does someone watching devnet through the public RPC see at that moment?',
        choices: [
          'A new certificate event, so they can count the stake that has voted',
          'Nothing. Alpenglow votes are off-chain gossip, so no RPC reports them',
          'The vote, once the gossip has spread to the RPC node',
          'A new slot with no block, which is how a vote looks from outside',
        ],
        answer: 1,
        explain: `Alpenglow does not write votes into blocks. They travel as **off-chain gossip**, and there is no account, no instruction and no account state that records them. A public RPC can report a transaction, a slot, a block, whether a slot was skipped, and a commitment level. It cannot report a vote, a notarization certificate or propagation.

So the honest answer to "what would devnet show here" is *nothing at all*, and the Pool tally you are looking at is entirely inside the model.`,
      },
      body: (hit) => `The selected validator just recorded a notarization vote for slot **${hit && hit.type === 'pool_event' ? hit.slot : '?'}**. The **Votor** tab now shows its \`Voted\` flag, and the Pool tally behind it is accumulating stake.

Every number in that tally is computed by this simulator, from messages it generated itself.

Compare that with the live Devnet mode, where the commitment ladder is filled from what the RPC reported. Two very different kinds of evidence, shown in the same place in the app, which is exactly why the labels matter.`,
    },
    {
      id: 'certificate',
      title: 'The certificate, and the honest gap',
      protocol: 'alpenglow',
      trigger: { type: 'certificate', kind: 'fast_finalization' },
      tab: 'votor',
      selectNode: 'hit',
      body: (hit) => `A **fast-finalization certificate** formed at ${fmtMs(hit?.t)}, carrying ${hit && hit.type === 'certificate' ? Math.round(hit.stake_pct * 100) : '?'}% of stake. This is the event the whole protocol is designed to reach.

This is also the clearest statement of what the two modes can and cannot do:

| | this run | a real devnet trace |
| --- | --- | --- |
| block arrived in slot N | yes | yes |
| slot N was skipped | yes, when it happens | yes, when it happens |
| certificate formed | yes | **no RPC reports this** |
| who voted, and when | yes, per node | **no, votes are gossip** |
| the transaction's commitment level | yes | yes |

The left column is a model of a consensus protocol. The right column is what a public API is willing to tell you. Alpenglow is live on devnet, so the right column is real data from a real cluster, and it is a fraction of what the left column claims. That gap is not a limitation of this app. It is the limit of observing consensus from outside.`,
    },
    {
      id: 'finalized',
      title: 'Finalized',
      protocol: 'alpenglow',
      trigger: { type: 'tx_stage', stage: 'finalized' },
      tab: 'transaction',
      body: (hit) => `The transaction is **finalized** at ${fmtMs(hit?.t)}. In this modeled run, finalization means a certificate carrying at least 60% of stake exists and every validator knows it.

Here is the honest comparison to make if you also run **Devnet** mode: your own real transaction will reach a commitment level that devnet itself reports, and it will do so without you ever being able to say which validators voted or when the certificate formed. Both of those finalizations are real. One of them is witnessed; the other is reasoned about.

That is the whole trade. Consensus that you can watch every step of is a model, because the real thing is gossip.`,
    },
  ],
  outro: `**What to take away.** A model can be checked against a cluster, and this one was: two numbers, one of them a shape. What a model cannot do is stand in for the thing it models, and the gap is not a missing feature.

The next thing to try is **Devnet** mode: paste a signature you sent yourself, or connect a wallet and send one from the panel. You will see the right-hand column of that table filled from a real cluster, and the left-hand column empty forever.`,
};
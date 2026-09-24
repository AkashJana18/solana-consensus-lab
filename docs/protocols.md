# The two protocols, as simulated

This is the reference for what the simulator actually does, written for
instructors. Every rule below maps to code in `crates/sim-core/src/protocol/`.

## Shared stage: a transaction's journey

Both protocols emit the same eight `tx_stage` events for the "hero" transaction:

| Stage | TowerBFT | Alpenglow |
|---|---|---|
| `submitted` | Client hands the tx to an RPC node. | Same. |
| `forwarded_to_leader` | Gulf Stream: RPC forwards to the current leader and the next two (no mempool). Re-forwarded every slot until it appears in a block. | Same, targeting the current and next-window leader. |
| `included_in_block` | Leader packs it into an FEC set at a PoH tick. | Leader packs it into a slice. |
| `propagating` | Turbine: shreds fan out through a stake-weighted tree (fanout 4 here, 200 on mainnet). | Rotor: each shred goes to one stake-weighted relay which re-broadcasts to everyone (single hop). Toggle `propagation: turbine` to see Votor over Turbine, which is how mainnet ships first. |
| `replayed` | A node reconstructed the block (≥ data shreds per FEC set) and executed it. | Same, per slice. |
| `voted` | Node casts a **vote transaction** for the block (its whole tower). | Node broadcasts a **Notarize** vote packet. |
| `confirmed` | Optimistic confirmation: ≥ ⅔ stake's latest votes are on the block or descendants. | **Notarization certificate**: ≥ 60% Notarize votes. |
| `finalized` | The node **roots** the block: 32 votes stacked on top of it (~12.8 s). | **Fast-Finalization certificate** (≥ 80% Notarize) or **Finalization certificate** (≥ 60% Finalize votes after notarization). |

## TowerBFT (`protocol/tower`)

**Clock.** Proof of History gives every leader a local clock; the simulator
models it as fixed 400 ms slots (`slot_ms`). Leader windows are 4 slots.

**Block production.** At its slot boundary the leader builds on the heaviest
fork it has *replayed*. If it has not yet replayed the previous slot's block,
it waits up to `grace_ms` (200 ms, Agave's grace ticks) before building on an
older parent — this is how a slow network turns into skipped slots and forks.
The block streams out as `fec_sets_per_block` FEC sets of
`fec_data_shreds + fec_coding_shreds` shreds; a set is recoverable from any
`fec_data_shreds` of them.

**Turbine.** For each shred a deterministic stake-weighted permutation of the
validators (seeded by slot, index and block) defines a complete k-ary tree.
The leader sends the shred to the root; every node forwards to its children on
first receipt — even after it has already reconstructed the block, otherwise
nodes deeper in the tree starve. Blocks that stay incomplete for a slot are
fetched whole with `repair` messages (e.g. when an offline node sat in the tree).

**Votes are transactions.** After replaying a block on its fork-choice head a
node votes if: (1) it is not switching forks, or ≥ 38% of stake is already on
forks conflicting with its last vote (`switch_threshold`); (2) no earlier
vote on another fork is still locked out; (3) the vote that would sit at tower
depth 8 has ≥ ⅔ stake behind it (`threshold_depth`, `threshold_size`). The
vote is sent to the current and next leaders' TPU as a ~300-byte transaction
(and gossiped so peers can count it immediately). Leaders pack vote
transactions into their blocks — on mainnet they are ~75% of all transactions.

**The tower.** Votes stack. Each vote starts with `confirmation_count = 1`;
every time a newer vote lands on top, every vote deeper in the stack than its
count doubles its lockout (2, 4, 8, … slots). Voting on a different fork before
a lockout expires is a slashable violation, so nodes simply refuse. When the
stack exceeds 31 entries the oldest vote is popped and becomes the **root**:
the node treats that block as final (~32 × 400 ms ≈ 12.8 s after it was made).

**Fork choice.** Heaviest subtree: each validator's *latest* vote adds its
stake to the voted block and all of its ancestors; from the root, descend into
the heaviest child (ties → lower slot) among replayed blocks.

## Alpenglow (`protocol/alpenglow`)

**Clock.** No PoH. A leader starts its window when its Pool reports
`ParentReady(s, parent)`; slot *i* of the window begins Δblock after slot
*i − 1*. Validators set local **timeouts** for the window's slots at
`ParentReady + Δtimeout + i·Δblock` (`timeout_ms`; default 900 ms because a
block is voted on only after all its slices have arrived).

**Rotor.** Each slice is `shreds_per_slice` erasure-coded shreds; the leader
sends shred *j* to relay *j* (one stake-weighted draw per shred, so a node's
chance of relaying is proportional to its stake) and the relay broadcasts it to
all. Any `data_shreds` of them reconstruct the slice. **Blokstor** reports the
first complete block per slot.

**Votor per-slot flags** (white paper v1.1, Algorithms 1–2):

| Event | Handler |
|---|---|
| `Block(b)` complete & replayed | `TryNotar(b)`: if not `Voted` and the parent is acceptable (first slot of window: `ParentReady(parent)`; later slots: we voted Notarize for the parent in slot − 1) → **Notarize(b)**, set `Voted`, `VotedNotar(b)`. Otherwise buffer b. |
| `ParentReady(s, p)` | Record p; for the first slot of a window set the timeouts (once); retry buffered blocks. |
| `Timeout(s)` | If not `Voted`: `TrySkipWindow(s)` — **Skip** every not-yet-voted slot to the end of the window; set `BadWindow`. |
| `SafeToNotar(s, b)` | `TrySkipWindow(s)`; if not `ItsOver`: set `BadWindow`, **NotarFallback(b)**. |
| `SafeToSkip(s)` | `TrySkipWindow(s)`; if not `ItsOver`: set `BadWindow`, **SkipFallback(s)**. |
| `BlockNotarized(s, b)` | If `VotedNotar == b` and not `BadWindow`: **Finalize(s)**, set `ItsOver`. |

**Pool** (every node): counts votes per slot per validator (one Notarize/Skip
each; fallbacks and Finalize separately), forms certificates the moment a
threshold is crossed, and broadcasts each certificate once:

| Certificate | Counted votes | Threshold |
|---|---|---|
| Notarization | Notarize(b) | 60% |
| Notar-Fallback | Notarize(b) + NotarFallback(b) | 60% |
| Skip | Skip + SkipFallback (each validator's stake counted once) | 60% |
| Fast-Finalization | Notarize(b) | 80% |
| Finalization | Finalize(s) | 60% |

Derived events: `BlockNotarized` (Notarization cert), `ParentReady(s, b)` (b
notarized or notar-fallback — genesis counts — and every slot between b and
the window start s has a Skip cert), `SafeToNotar(s, b)` (node already voted
in s, not for b, and Notarize(b) ≥ 40%, or Notarize(b) ≥ 20% with
Notarize(b) + Skip(s) ≥ 60%), `SafeToSkip(s)` (node already voted in s, and
Skip + SkipFallback + Notarize votes for blocks other than its own ≥ 40%).

**Finality.** A block is final on a Fast-Finalization certificate, or on a
Finalization certificate for its slot together with its Notarization
certificate; finality is inherited by ancestors. A Skip certificate finalizes
an empty slot. Nodes that learn of a certificate for a block they lack repair it.

**Standstill recovery.** Votes and certificates are sent once, so two halves
of a healed partition have never seen each other's votes for the stalled slots,
and everyone has already voted. A node that observes no new finalization for
Δstandstill (`standstill_ms`, teaching default 2 s; the paper's value is much
longer) re-broadcasts its own votes and every certificate it holds from the
last finalized slot on. The pooled Skip / SkipFallback / NotarFallback votes
then reach 60% and the stalled window closes. The `standstill:` log line marks
each burst.

**Transactions in skipped blocks.** A leader that sees a Skip certificate for
a slot it produced returns that block's transactions to its queue; an RPC node
that forwarded a transaction into such a block re-forwards it (the `slot N was
skipped with tx 0 inside` log line).

**Resilience (20+20).** Safety holds with < 20% Byzantine stake (two
conflicting 60% certificates need ≥ 20% double votes). Liveness holds with a
further ≤ 20% offline: the fast path needs 80%, the slow path 60%.

## Where the numbers come from

Latencies are one-way medians between six regions (EU-central, EU-west,
US-east, US-west, Tokyo, Singapore) with log-normal jitter (σ = 0.15) and
1 Gb/s egress serialization; execution takes 15 ms. Shred = 1228 bytes,
Tower vote tx = 300 bytes, Alpenglow vote = 150 bytes, certificate = 1000 bytes.

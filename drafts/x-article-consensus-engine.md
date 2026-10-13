# 150 ms

**I built a deterministic discrete-event simulator of Solana's consensus to find out where 12.8 seconds goes. Four things came out of it that the headline numbers do not tell you.**

Live at solanaconsensuslab.com · Apache-2.0 · github.com/AkashJana18/solana-consensus-lab

Not affiliated with or endorsed by the Solana Foundation. "Solana" is a trademark of Solana Foundation, used here only to name the protocol being simulated.

---

Every explanation of Solana finality ends at the same two numbers: TowerBFT roots a block about 12.8 seconds after it is made, and Alpenglow finalizes one in about 150 milliseconds.

Both numbers are real. Neither one answers the questions I actually had:

1. How much of the 12.8 seconds is the protocol, and how much is just a leader spending 400 ms assembling a block that nobody can vote on yet?
2. What does the shorter time cost in bytes and messages? Finality latency is usually discussed as a free win, and it is not free.
3. Where exactly does each protocol stop working when stake goes offline?
4. Which of these numbers would a live devnet RPC even let me verify?

Answering those needs per-message, per-validator, per-certificate data. That data does not exist anywhere public, because Alpenglow's votes are off-chain gossip by design (SIMD-0326): notarization votes, certificates, Pool events, Votor flags and Rotor relay choice are structurally invisible to any outside observer. So the answer had to be simulated, and it had to be simulated carefully enough that I would trust it against the paper.

Everything below is measured, not asserted. Every number comes out of `cargo run -p sim-cli -- run --scenario happy-path --protocol both` on seed 1 with 25 validators over 16 seconds. There is a test that fails if the 150 ms number drifts.

---

## 1. The engine: one heap, one trace

The core is a deterministic discrete-event simulator. Not a Monte Carlo, not a recorded replay. A heap of events keyed by `(time, insertion sequence)`:

```rust
// Reversed so BinaryHeap pops the earliest (at, seq).
fn cmp(&self, o: &Self) -> Ordering {
    o.at.cmp(&self.at).then_with(|| o.seq.cmp(&self.seq))
}
```

The `seq` tiebreak is load-bearing. Two events landing on the same microsecond must run in a fixed order or the whole thing stops being reproducible.

Messages are scheduled, never delivered inline. `Network::transit` returns an arrival time, and the engine pushes a `Deliver` event. That one decision is why latency, bandwidth, partitions and node outages are ordinary cases instead of special cases sprinkled through protocol code. A protocol physically cannot deliver a message instantly, because it does not deliver messages at all.

The engine/protocol boundary is the part I care about most. A protocol is pure handlers over per-node state, and every side effect comes back as data:

```rust
pub enum Action<P: Protocol> {
    Send { to: NodeId, msg: P::Msg },
    Broadcast { msg: P::Msg, include_self: bool },
    Timer { at: SimTime, timer: P::Timer },
}
```

`send`, `broadcast` and `set_timer` push onto a `Ctx`. The engine applies the collected actions *after* the handler returns, in one place. Faults, latency and bandwidth are therefore applied exactly once, in code the protocols cannot bypass, and a protocol handler is testable with no network at all.

There is also a `Protocol::ENGINE_SLOTS` flag that says whether the engine's fixed slot clock means anything. TowerBFT says yes, because PoH is a real 400 ms slot clock. Alpenglow says no, because it has no global clock: it paces itself from `ParentReady(s, parent)` plus `i * Δblock`. Same engine, same trace, one bit of difference.

### Everything observable is a trace event

`TraceEvent` in `crates/sim-core/src/trace.rs` is the entire API of the project. The CLI, the metrics, the property tests and the browser all read that one union. There is no side channel and no UI-side state that could disagree with the simulation.

A 16 second healthy run produces 104,010 trace events, of which 90,490 are `msg_sent`. If the UI can show it, the engine emitted it. The animation cannot draw a certificate the protocol did not produce, which is the property that makes it safe to let a non-expert scrub the timeline looking for things that look wrong.

---

## 2. Determinism is the product, not a nicety

Three rules, and then it is verified rather than asserted:

```rust
let mut rng = Rng::seed(scenario.seed);
let validators = scenario.validators.build(&mut rng.fork(1));
let network = Network::build(&scenario.network, &scenario.validators.regions, n, &mut rng.fork(2));
// ... faults on rng.fork(4)
```

All randomness is xoshiro256\*\*, forked per subsystem with fixed tags. Validator stakes, node placement, leader selection, fault targeting and latency jitter never share a stream, so changing any one of them does not reshuffle the others. Nothing that affects behavior iterates a `HashMap`; ordered containers only. The `Simulator` is fully serde-serializable, so `snapshot`/`restore` continues a run exactly.

The checks are `both_protocols_are_deterministic` (every built-in scenario, both protocols, twice, serialized traces compared), `snapshot_roundtrip_continues_identically`, and a proptest file with regression seeds checked into git so a found failure keeps failing until it is fixed.

Here is what that buys in the browser. Scrubbing backwards does not ship snapshots to the UI:

```ts
/** Move the display clock. Backwards scrubs re-create the deterministic Sim in the worker. */
seek(tMicros: number): void {
  const t = Math.max(0, Math.min(this.end || tMicros, tMicros));
  if (t < this.displayTime) {
    for (const run of this.runs.values()) {
      run.buffer.clear();
      run.scene?.particles.clear();
      // ... view reset ...
      run.client.reset(t);
    }
  }
  // ...
}
```

The worker throws the simulation away, builds a fresh `Sim` and fast-forwards to the target. No snapshot store, no ring buffer of past states, no approximation. "Back" in a lesson is a plain seek and it lands on exactly the same microsecond every time, at 0.25x speed and at 64x speed, because it is literally the same simulation re-run.

For a teaching tool this matters more than it looks. A scrub that is off by 4 ms teaches the wrong thing, and a reader who can catch your tool being wrong will not trust the parts that are right.

---

## 3. Modelling the protocols without simplifying them

The rule I set for myself: if a rule is inconvenient, expose it as a parameter, do not delete it.

Alpenglow's Votor is implemented as the per-slot flag machine from white paper v1.1, Algorithms 1 and 2, and its Pool counts votes per slot per validator and forms certificates the moment a threshold is crossed:

| Certificate | Counted votes | Threshold |
|---|---|---|
| Notarization | Notarize(b) | 60% |
| Notar-Fallback | Notarize(b) + NotarFallback(b) | 60% |
| Skip | Skip + SkipFallback, each validator's stake counted once | 60% |
| Fast-Finalization | Notarize(b) | 80% |
| Finalization | Finalize(s) | 60% |

TowerBFT follows Agave's `vote_state`: 38% switch threshold, no vote while a conflicting lockout is live, threshold depth 8 at two thirds, lockouts doubling 2, 4, 8, and a root when the stack passes 31 entries. That is where 12.8 s comes from, and it is 32 slots of 400 ms, not anything a parameter can wish away.

Two examples of "expose, do not simplify":

- `timeout_ms` defaults to 900 ms because a block is only voted on once every one of its slices has arrived. Set it to 400 and the cluster starts skipping perfectly healthy leaders, which is correct behavior, just not the behavior the paper describes.
- `standstill_ms` defaults to 2 s instead of the paper's ~10 s. Votes are sent once, so after a partition heals, both halves already believe they voted and nothing re-sends. Without a standstill re-broadcast the healed cluster deadlocks forever. At 10 s that recovery is invisible in a 16 s run, so the teaching default is short on purpose and says so in the source comment.

Teaching-sized parameters are labelled as such too: 8 shreds per slice with 4 needed instead of Γ=64 / γ=32, and 25 validators instead of ~1,500, so that dissemination is something you can watch rather than something that happens instantaneously.

---

## 4. What the measurements say

### 4.1 The 150 ms and the 451 ms are the same consensus

Same 25 validators, same seed, no faults. The only difference is when the client submits.

| Scenario | Submit | Lands in | Included → final | Fast path |
|---|---|---|---|---|
| happy-path | 250 ms | slice 0 | **450.6 ms** | 80% notarize |
| ideal | 550 ms | slice 3 (last) | **149.6 ms** | 80% notarize |

Three times the finality, same cluster, same protocol, same code path. The cause is a rule that is easy to miss: a hero transaction can only be voted on once its block is *complete*, meaning the leader has produced all four slices across the whole 400 ms Δblock. Submit early and you pay the full assembly; submit late and you ride the last slice and pay only the voting.

Measured the way the paper measures it (BlockReceived → Commitment{Finalized} on the same block, per validator) the `ideal` scenario gives a median validator 149 ms. The paper reports ~150 ms for randomly chosen leaders in Fig. 14. That number is guarded by `ideal_matches_the_papers_150ms_median`, so if I ever quietly tune a default to make the demo look nicer, the build breaks.

The takeaway is not "150 ms". It is that the headline is a distribution over *where in the block* your transaction happened to land, and it is dominated by block assembly, not by consensus.

### 4.2 Alpenglow buys time with messages, not with bytes

Same 16 seconds, 25 validators, healthy:

| | Messages | Bytes | Mean message |
|---|---|---|---|
| Alpenglow | 90,490 | 59,399,576 (59.4 MB) | 656 B |
| TowerBFT | 57,393 | 64,507,560 (64.5 MB) | 1,124 B |

Alpenglow sends **58% more messages** and **8% fewer bytes**. The reason is the one structural change people remember: a vote is a 150-byte gossip message instead of a 300-byte transaction packed into a block.

Both protocols broadcast to all 24 peers here, so one vote is 24 wire messages in either case. Alpenglow just has smaller payloads and more of them, because off-chain votes do not need a block to travel in.

So TowerBFT's extra 12.4 seconds is not bandwidth. It buys a data structure (the tower) and nothing else. Alpenglow's cost is message count and per-node CPU, which is a different resource and a different scaling story.

### 4.3 Certificates are the line item nobody quotes

Splitting Alpenglow's 59.4 MB by purpose:

| Purpose | Bytes | Share |
|---|---|---|
| Shreds (block data) | 35,960,752 | 60.5% |
| Certificates | 16,728,000 | 28.2% |
| Votes (Notarize + Finalize) | 6,670,800 | 11.3% |

There were 112 *distinct* certificates in those 16 seconds: 38 notarization, 37 fast-finalization, 37 finalization. But certificates are gossiped by every node that holds one, median 6 nodes per certificate, and each broadcast fans out to 24 peers: 697 broadcast actions become 16,728 wire messages.

A certificate is 1000 bytes. A vote is 150. So the certificate channel costs **2.5x the vote channel in bytes** while carrying a third as many logical objects, and it is 28% of everything Alpenglow puts on the wire in a healthy cluster. That is the price of turning "everyone agreed" into a portable, verifiable object, and the latency win does not make it free.

Caveat I would want a reviewer to see: the 28% is a function of cluster size. At 25 validators the fan-out is 24/25 of the cluster, and certificate formation per node per slot does not grow with the cluster, so the percentage is a small-cluster artifact. The per-certificate cost is the durable claim.

### 4.4 Where each protocol actually breaks

Sweeping offline stake on the `offline-25pct` scenario, seed 1, 20 second window:

| Offline stake target | Alpenglow finalization | TowerBFT rooting |
|---|---|---|
| 0% | 850.6 ms | 13,115 ms |
| 8% | 892.9 ms | 15,515 ms |
| 16% | 913.0 ms | 16,315 ms |
| 20% | 928.7 ms | 16,315 ms |
| 24% | 982.8 ms | not within 20 s |
| 28% | 1,010 ms | 17,250 ms |
| 32% | 1,026 ms | 19,019 ms |
| 36% | 1,049 ms | not within 20 s |
| 40% | 1,093 ms | not within 20 s |
| 44% | no blocks produced | not within 20 s |

Two things to read out of that.

**Alpenglow's cliff is at 40%, not 20%.** The slow path needs 60% Notarize and then 60% Finalize, so it needs 120% of stake, which means exactly 40% of stake can be offline and no more. The simulator finds the boundary where the thresholds put it. The famous "20+20" is 20% *Byzantine* plus 20% offline; with a crash-only adversary the model's own arithmetic puts liveness at 40% offline, and 44% kills it outright.

**TowerBFT degrades smoothly and then stops.** Every increment of offline stake pushes the rooting time out, because fewer votes per slot means a taller tower, means more slots of history. At 20% it still roots inside the window; by 24% it does not finish.

Honest caveats on this table, which I would rather state than let a reader discover:

- Realized offline stake can land *below* the target. Picking fault targets by "any node that fits" once took a 95% whale offline for a 19% request. The target-selection logic now under-shoots on purpose, so the right-hand column is noisy near the top end.
- The 20 second horizon is only 1.5x the 12.8 second rooting time, so Tower's blank cells are partly a window effect rather than a livelock. The trend up to 20% is monotone; the cliff position is not resolved by this sweep.

### 4.5 TowerBFT spends 30% of its bytes on repair, on a healthy cluster

No faults, zero dropped messages, 16 seconds: 1,139 repair requests and 992 responses, each response 19,648 bytes. That is 19,490,816 bytes, **30.2% of TowerBFT's total traffic**, spent re-fetching blocks that were already being disseminated.

Cause: the teaching-sized shred counts (8 per FEC set, 4 needed) with a fanout-4 Turbine tree over 25 nodes put four nodes at depth 3, where missing one set means missing the block. Turbine nodes forward to children even after reconstructing the block, otherwise deep nodes starve, but with this few shreds per set, depth still costs you.

I am not claiming mainnet spends 30% on repair. I am claiming that the simulator will happily show you a pathology that only exists because you made the shreds small enough to see them, which is exactly the kind of thing a real simulator should be able to tell you.

Also worth noting from the same run: Tower packed **408 vote transactions, 122.4 KB of block space**, into 16 seconds of block production. Alpenglow packed zero bytes of votes into blocks. That is the on-chain cost argument in its cleanest form.

---

## 5. Why I deleted the live devnet mode

I shipped one. It polled a public RPC, rendered real slots and commitment levels through the same timeline, and let you send a real devnet transfer. Then I removed it, and the reason is the most useful thing in this article for anyone building dev tooling on Alpenglow.

A live trace can only show what the network exposes. Alpenglow votes are off-chain gossip, so `getAlpenglowVoteAccounts`, `getVotorState` and `getAlpenglowStats` all return "Method not found". Not "not implemented yet": not implemented, because the data is not on chain and was never going to be. The certificate that made your transaction final is not observable by anyone who is not already a validator.

So the honest limit is structural, and shipping a mode that polls a public, rate-limited endpoint to every visitor of a deployed app was the wrong trade on top of it. The deletion was hard, not a build flag: the mode was a fourth arm through the controller, and removing it deleted four branches, a `RunSource` flag, a `@solana/kit` dependency and a lesson whose entire premise was a side-by-side comparison that no longer had a right-hand column. It is recoverable at the tag `live-mode-before-removal`.

If you are building monitoring or explorer tooling for Alpenglow: budget for the fact that you will see slots, blocks, skipped slots and commitment levels, and you will never see votes.

---

## 6. What is not modelled

Stated plainly, because a reader should be able to tell a modelled rule from a simplified one:

- **No cryptography.** Certificates carry their aggregated stake and are trusted on receipt. The 20% double-sign wall is argued from thresholds, not from signature checks.
- **No Byzantine adversary yet.** Faults model crashes, partitions, delay and loss. Equivocation is a roadmap item, not a claim.
- **25 validators, not ~1,500.** Propagation is simulated per message, so the shape of the latency distribution carries over but not its tail.
- **The network is a latency matrix**, one-way medians across six regions with log-normal jitter (σ = 0.15) and 1 Gb/s egress serialization, not a packet simulation.
- **Execution is a constant 15 ms**, not a function of the block's contents.
- **Standstill is 2 s, not the paper's 10 s**, so partition recovery is watchable.

Every one of these is either a parameter or a stated milestone. None of them is hidden in a constant with a plausible name.

---

## 7. Run it yourself

```bash
cargo test --workspace
cargo run -p sim-cli -- run --scenario happy-path --protocol both
cargo run -p sim-cli -- inspect --scenario partition-heal --node 3 --at-ms 3000
cargo run -p sim-cli -- sweep --scenario offline-25pct \
  --param faults.0.target.stake_pct=0..0.44:0.04 --seeds 3 --csv sweep.csv
```

The browser build is the same Rust compiled to wasm, one Web Worker per protocol, one display clock, events drained into a time-indexed buffer and reduced into panel state. Nothing per-frame goes through React; the canvas is driven imperatively from the same drain. A 25-node run emits about 100k events, so events are never rendered as DOM.

App: solanaconsensuslab.com
Repo: github.com/AkashJana18/solana-consensus-lab

Apache-2.0. Contributions welcome, especially the Byzantine adversary.

---

## Appendix: eight posts, if you would rather thread it

1. The claim: 12.8 s versus 150 ms, and the two questions neither number answers.
2. Why not a live devnet trace: Alpenglow votes are gossip, `getVotorState` does not exist, the data is not on chain.
3. The engine: a `(time, seq)` heap, messages scheduled rather than delivered, latency as an ordinary case.
4. Pure handlers, `Action` as data, one place where faults and bandwidth are applied.
5. The trace event union is the whole API. 104,010 events in 16 s. The UI cannot draw what the engine did not emit.
6. Determinism as a feature: rewinding by rebuilding the sim, not by shipping snapshots.
7. The measurements: 451 ms versus 150 ms, 28% of bytes on certificates, the 40% cliff, 30% of Tower's bytes on repair.
8. The honest limits, then the repo.

---

*Measured numbers in this article were produced with sim-cli on seed 1 unless stated. If you find one that does not reproduce, open an issue with the command; that is a bug in the article or in the tool, and both are worth knowing about.*
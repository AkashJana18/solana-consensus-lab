# Engine ↔ UI contract

The web UI never simulates anything. It drives a WebAssembly build of `sim-core`
through the `Sim` class below and renders the **trace events** it returns.

## `Sim` (wasm-bindgen, package `sim-wasm`, imported from `web/src/wasm/pkg`)

```ts
class Sim {
  constructor(protocol: "alpenglow" | "tower", scenarioJson: string); // throws on invalid scenario
  meta(): string;            // JSON SimMeta (below)
  runUntil(tMicros: number): string; // advances sim clock to t; returns JSON Traced[] produced since last call
  step(): string;            // processes exactly one event; returns JSON Traced[]
  now(): number;             // sim time, microseconds
  end(): number;             // scenario end, microseconds
  isDone(): boolean;
  inspect(node: number): string;   // JSON, protocol-specific node view (see below)
  metrics(): string;         // JSON Metrics accumulated over all events so far
  snapshot(): Uint8Array;
  static restore(protocol: string, bytes: Uint8Array): Sim;
  protocol(): string;
}
function scenarioNames(): string;           // JSON string[]
function builtinScenario(name: string): string | undefined; // scenario JSON text, undefined if unknown
function validateScenario(json: string): string; // "ok" or error message
```

All trace times are **microseconds** of simulated time (`t`, `arrive_at`, `now()`, `end()`).
Exception: `metrics().tx_stage_ms` is in milliseconds, as the name says.

Units for stake: `certificate.stake_pct` is a 0–1 fraction; `inspect().pool[*].pct`
values are 0–100 percentages.

### SimMeta
```ts
interface SimMeta {
  protocol: "alpenglow" | "tower";
  n: number;                 // validator count
  stakes: number[];          // per node, sums to total_stake; node 0 is the largest
  total_stake: number;
  regions: string[];         // region names
  node_region: number[];     // index into regions, per node
  leaders: number[];         // leader per window (window w covers slots [w*window, (w+1)*window))
  window: number;            // 4
  slot_ms: number;           // 400
  num_slots: number;
  duration_us: number;
  scenario: Scenario;        // the full parsed scenario (name, description, faults, params...)
}
```

## Trace events (`Traced`)

Every element is `{ t: number } & TraceEvent`, discriminated by `type`
(snake_case). Node ids are integers. `hash` values are opaque numeric ids kept
below 2^53, so they survive `JSON.parse` exactly; compare by equality and show
a short prefix of `hash.toString(16)` in the UI. `0` is genesis.

| type | fields | meaning |
|---|---|---|
| `slot_start` | `slot, leader` | A leader began a slot (Tower: engine clock; Alpenglow: leader started producing). |
| `msg_sent` | `id, from, to, kind, bytes, arrive_at, dropped?, slot?` | Draw a particle from `from` to `to` between `t` and `arrive_at`. If `dropped` is set the particle should fizzle mid-way. `kind` is one of the message kinds below. |
| `msg_dropped` | `id, reason` | `reason ∈ partition, random, receiver_offline, sender_offline`. |
| `node_offline` / `node_online` | `node` | Dim / undim the node. |
| `partition_start` | `groups: number[][]` | Draw a divider between groups. |
| `partition_end` | | |
| `block_produced` | `slot, hash, parent, leader, txs, vote_txs` | New block. Add to fork tree. `txs` lists user tx ids the leader is packing at block start (the hero tx is `0`); txs that arrive mid-block are only visible via `tx_stage: included_in_block`. `vote_txs` = vote transactions packed (Tower only). |
| `block_received` | `node, slot, hash` | Node reconstructed the block from shreds. |
| `block_replayed` | `node, slot, hash` | Node executed the block. |
| `vote` | `node, slot, kind, hash?` | `kind ∈ notarize, notar_fallback, skip, skip_fallback, finalize, tower`. |
| `certificate` | `node, slot, kind, hash?, stake_pct` | Node formed a certificate (Alpenglow). `kind ∈ notarization, notar_fallback, skip, fast_finalization, finalization`. |
| `pool_event` | `node, slot, kind, hash?` | `kind ∈ block_notarized, parent_ready, safe_to_notar, safe_to_skip`. |
| `votor_flag` | `node, slot, flag, hash?` | Flag set: `voted, voted_notar, bad_window, its_over, block_notarized, parent_ready`. |
| `timeout` | `node, slot` | Votor timeout fired. |
| `tower_update` | `node, lockouts: {slot, confirmation_count}[], root?` | Tower after a vote (TowerBFT). |
| `fork_choice` | `node, head_slot, head_hash` | Node's heaviest fork head changed. |
| `commitment` | `node, slot, hash, level` | `level ∈ processed, confirmed, finalized` — node's local view. |
| `tx_stage` | `tx, stage, node?, slot?, detail?` | Hero tx progress: `submitted, forwarded_to_leader, included_in_block, propagating, replayed, voted, confirmed, finalized`. Many nodes emit the same stage; use the **first** occurrence for the timeline. |
| `log` | `node?, msg` | Free text. |

### Message kinds (for particle colouring)
Alpenglow: `shred`, `vote:notarize`, `vote:notar_fallback`, `vote:skip`,
`vote:skip_fallback`, `vote:finalize`, `cert:notarization`, `cert:notar_fallback`,
`cert:skip`, `cert:fast_finalization`, `cert:finalization`, `repair:request`,
`repair:response`, `tx`.
Tower: `shred`, `vote:tower` (vote transaction to leader), `vote:gossip`
(vote shared peer-to-peer), `tx`, `repair:request`, `repair:response`.

Volume: a 25-node, 6 s Alpenglow run emits ~60k `msg_sent` events. The UI must
run the sim in a Web Worker and render from a time-indexed buffer; never render
the whole array as DOM.

## `inspect(node)` payloads

Alpenglow:
```ts
{
  protocol: "alpenglow", node, highest_finalized_slot, finalized_blocks, hero_block,
  votor: { slot, voted, voted_notar, its_over, block_notarized, parents_ready: number[], bad_window, pending }[],
  // one entry per slot in the window shown; `null` for slots with no votes yet
  pool: ({ slot, notarize: {hash, pct}[], notar_fallback: {hash,pct}[], skip_pct, skip_fallback_pct, finalize_pct, certs: {kind, hash}[] } | null)[],
  leader: { pending_txs: number[], produced_slots: number[] }
}
```
Tower:
```ts
{
  protocol: "tower", node, root: number | null,
  lockouts: {slot, confirmation_count}[],           // bottom (oldest) first; lockout = 2^confirmation_count slots
  head: { slot: number | null, hash },              // heaviest-subtree fork choice among replayed blocks
  last_vote: [slot, hash] | null,
  forks: { hash, slot, parent, leader, weight_pct, replayed, confirmed, rooted }[],  // blocks from ~root onward
  hero_block: number | null,
  last_reason: string,                              // why the node last refused to vote ("" if none)
  leader: { pending_txs: number[], pending_vote_txs: number }
}
```

Both protocols also emit `log` events with human-readable reasons (threshold check
failed, locked out, cannot switch forks, grace period over, tx retry), which the
Events panel should show verbatim — they are written for students.

## Metrics
```ts
{
  tx_stage_ms: Record<Stage, number>,          // first time each stage was reached
  msgs: Record<Kind, {count, bytes, dropped}>, total_msgs, total_bytes,
  votes: Record<VoteKind, number>, certificates: Record<CertKind, number>,
  slots_started, blocks_produced,
  vote_txs_in_blocks, vote_tx_bytes_in_blocks   // Tower vote transactions packed into blocks and their block-space cost (300 B each); 0 under Alpenglow
}
```

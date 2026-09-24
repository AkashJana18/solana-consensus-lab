# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A deterministic discrete-event simulator of Solana consensus that runs the same
scenario under **TowerBFT** (mainnet today) and **Alpenglow** (SIMD-0326), for
teaching. Rust core → WebAssembly → React/PixiJS UI, plus a headless CLI.
Protocol rules are paper-faithful on purpose (Alpenglow white paper v1.1, Agave
`vote_state`). Do not simplify a rule for convenience; expose it as a parameter
instead. `docs/protocols.md` is the instructor-facing spec of what is modeled.

## Commands

Rust workspace (`crates/sim-core`, `crates/sim-wasm`, `crates/sim-cli`):

```bash
cargo test --workspace                                  # all unit + property tests
cargo test -p sim-core happy_path_fast_finalizes_hero_tx # one test by name
cargo test -p sim-core --test properties                # proptest safety/liveness/determinism
cargo run -p sim-cli -- scenarios
cargo run -p sim-cli -- run --scenario happy-path --protocol both
cargo run -p sim-cli -- inspect --scenario partition-heal --protocol tower --node 3 --at-ms 3000
cargo run -p sim-cli -- sweep --scenario offline-25pct --param faults.0.target.stake_pct=0..0.4:0.05 --seeds 10 --csv sweep.csv
```

Web (`web/`). Use **bun**, never npm/npx/node (the nvm shim is broken in
non-interactive shells on this machine):

```bash
./scripts/build-wasm.sh          # from repo root; required before any web command, rerun whenever crates/ changes
cd web && bun install
bun run dev                      # http://localhost:5173 (strictPort)
bun run test                     # vitest unit tests (test/*.test.ts, node env)
bunx vitest run test/eventBuffer.test.ts   # one unit test file
bun run e2e                      # Playwright; starts dev server itself. Once: bunx playwright install chromium
bunx playwright test e2e/lesson.spec.ts    # one e2e spec
bun run build                    # strict tsc (zero errors) + vite → web/dist
cargo run -p sim-cli -- run --scenario leader-down --protocol alpenglow --events 100000 --only certificate,pool_event  # check event timings before writing lesson copy (--events defaults to 0 = print none)
```

`web/src/wasm/pkg/` is a gitignored build artifact produced by
`build-wasm.sh` (needs `rustup target add wasm32-unknown-unknown` and
`wasm-bindgen-cli` exactly 0.2.128, matching the pinned crate dep). `tsc` and
vitest both fail without it. There is no lint step; `bun run build`'s tsc pass
is the type check. CI (`.github/workflows/ci.yml`) runs cargo test → wasm build
→ (bun test + bun build) and (Playwright e2e) in parallel → GitHub Pages deploy.

`web/package.json` pins `@swc/core ~1.12.14` via `overrides` because
`vite-plugin-top-level-await` breaks with 1.16. Leave it.

## Architecture

```
scenarios/*.json ─▶ sim-core (Rust DES) ─▶ Vec<Traced> trace events
                      protocol::alpenglow  (Rotor · Blokstor · Pool · Votor)
                      protocol::tower      (PoH · Turbine · TowerState · ForkTree)
                      ├─▶ sim-cli   (consensus-lab: run / inspect / replay / sweep)
                      └─▶ sim-wasm  ─▶ web/ (Worker ▸ EventBuffer ▸ Controller ▸ PixiJS + React)
```

**Everything observable is a trace event.** `crates/sim-core/src/trace.rs`
defines `TraceEvent`; the CLI, `metrics.rs`, the property tests and the UI all
consume only this stream. If the UI needs to show something new, add a trace
event (and mirror it in `web/src/engine/types.ts` and `docs/wasm-api.md`),
never a side channel.

**Engine / protocol split** (`sim.rs` + `protocol/mod.rs`). `Simulator<P>` owns
the event heap, nodes, `Network`, `FaultState`, RNG and trace. A `Protocol`
implements pure handlers (`on_start`, `on_slot`, `on_message`, `on_timer`,
`on_client_tx`, `inspect`) over `P::Node`; side effects are `Action`s queued on
`Ctx` (`send`, `broadcast`, `set_timer`, `emit`, `log`) and applied by the
engine after the handler returns. `ENGINE_SLOTS` is true for Tower (PoH slot
clock) and false for Alpenglow (paces itself from ParentReady + Δblock).
`protocol/ping.rs` is the minimal reference protocol used by engine tests.
`blokstor.rs` (shred → block reconstruction) and `dissemination.rs`
(stake-weighted orders, Turbine children, Rotor relays, `block_hash`) are shared
by both protocols.

**Determinism is a hard invariant.** All randomness goes through `rng::Rng`
(xoshiro256**), forked per subsystem with fixed tags in `Simulator::new`.
Same scenario + seed must give a byte-identical trace; the
`both_protocols_are_deterministic` test and the UI's backward-scrub (which
rebuilds a fresh `Sim` and fast-forwards) both depend on it. Avoid `HashMap`
iteration order in anything that affects behavior (code uses `BTreeMap`/`BTreeSet`).
`Simulator` is fully serde-serializable for `snapshot`/`restore`.

**Scenarios** are JSON with defaults for every field (`scenario.rs`). The five
in `scenarios/` are `include_str!`-embedded as `scenario::BUILTIN`, so they ship
inside the wasm too; adding one means adding the file and the `BUILTIN` entry
(then rebuild the wasm; `test/lessons.test.ts` reads the directory).

**Lessons and breakpoints** (`web/src/lessons/`, `web/src/engine/breakpoint.ts`).
A lesson is a TypeScript object: scenario/mode/seed plus steps, each with a
declarative `Trigger`. `Controller.setBreakpoint` scans the watched run's
`EventBuffer.range(displayTime, target)` each frame *before* advancing the clock
and clamps the target to the first match's `t`, so stops are frame-exact at any
speed without rewinding. `lessons/runner.ts` loads the lesson's scenario through
the store (the same path the TopBar uses), waits for `controller.onConfigured`,
arms one breakpoint per step and records hit times so Back is a plain seek.
Lesson copy must match the deterministic trace: check timings with the CLI first.

**URL state** (`web/src/url/`). `App` hydrates the store from `location.search`
before the first `configure()` and seeks to `t` (milliseconds in the URL) once it
resolves; `startUrlSync` mirrors the store back with a debounced `replaceState`,
writing `t` only while paused. Custom scenarios go in `s=` as deflate-raw +
base64url.

**Engine ↔ UI contract** is `docs/wasm-api.md`; `crates/sim-wasm/src/lib.rs`
implements it and `web/src/engine/types.ts` mirrors it. Times are microseconds
except fields named `_ms`. `certificate.stake_pct` is 0–1, pool `pct` is 0–100.
Block hashes are u64 masked to 53 bits (`dissemination::block_hash`) so they
survive JSON → JS numbers; compare by equality only. The "Contract notes"
section of `web/README.md` lists known doc-vs-binding drift; update the doc when
changing the bridge.

**Web render loop** (see the diagram in `web/README.md`). One Web Worker per
protocol runs the wasm `Sim`; `engine/controller.ts` owns a single display clock
in a rAF loop, drains time-indexed `EventBuffer`s, updates the derived `RunView`
(`store/runView.ts`) and spawns pooled Pixi particles. React only observes the
zustand store at ≤15 Hz; nothing per-frame goes through React. A 25-node run
emits ~60k `msg_sent` events, so never render events as DOM.

## Modeling decisions that look like bugs but are not

- Alpenglow `timeout_ms` defaults to 900 ms; it must exceed Δblock + propagation or healthy leaders get skipped.
- Genesis (hash 0) counts as a notarized parent for `ParentReady`.
- Turbine nodes forward shreds to children even after they have already reconstructed the block; otherwise deep nodes starve.
- Tower leaders wait a 200 ms grace period for the previous block before building on an older parent.
- The RPC node re-forwards the hero tx (id 0) every slot until it lands (Gulf Stream, no mempool), and again if the block it landed in gets a Skip certificate; the leader re-queues that block's txs.
- Teaching defaults use small shred counts (8 per slice / FEC set, 4 needed) so propagation is visible.
- Alpenglow `standstill_ms` (default 2 s, paper value much longer): with no new finalization for that long a node re-broadcasts its votes and certificates. Without it a healed partition deadlocks, because votes are sent once and both halves have already voted.
- A validator's stake counts once towards a Skip certificate even if it casts Skip and SkipFallback (`pool.rs` tracks `skip_voters`).
- Rotor relays are sampled per shred with replacement, proportional to stake; a permutation made every node a relay in small clusters and offline low-stake nodes starved slices.
- `Target::StakePct` picks random nodes that fit under the target and, if far short, the *smallest* remaining node; the old "any node" overshoot could take a 45% whale offline for a 5% target.

## Tests

`cargo test --workspace` covers engine tests in `lib.rs`, protocol scenario
tests at the bottom of `protocol/alpenglow/mod.rs` and `protocol/tower/mod.rs`,
`vote_state.rs` lockout tests, and `tests/properties.rs` (proptest: Alpenglow
safe+live with ≤20% offline, no conflicting finalization through partitions,
Tower roots never conflict, determinism over all builtin scenarios).
`properties.proptest-regressions` is checked in; keep it (proptest replays those
seeds every run, so a newly found failure stays failing until fixed). Web unit
tests cover `eventBuffer`, `interp`, `txStages`, `url` (round trip, compression),
`breakpoint` (every trigger), `markdown`, and `lessons` (registry integrity);
`e2e/smoke.spec.ts` and `compare.spec.ts` write screenshots to
`web/e2e/screenshots/` that the README embeds, `lesson.spec.ts` follows the
Skip-certificates lesson, `share.spec.ts` restores a share link. The Events feed
is virtualised, so e2e assertions on it can only see the newest rows.

# Solana Consensus Lab — web front end

Interactive, pedagogical animation of how a transaction moves through Solana consensus
under **TowerBFT** and **Alpenglow**. The UI never simulates anything: it drives the Rust
engine (`crates/sim-core`) compiled to WebAssembly and renders the trace events it emits.

## Requirements

- [bun](https://bun.sh) ≥ 1.1 (package manager and script runner — do not use npm/npx)
- Rust toolchain + `wasm-bindgen` to (re)build the engine (`bash ../scripts/build-wasm.sh`)

## Develop

```sh
bash ../scripts/build-wasm.sh    # once, or whenever crates/ changes → web/src/wasm/pkg/
bun install
bun run dev                      # http://localhost:5173
```

## Build & deploy

```sh
bun run build                    # tsc (strict, zero errors) + vite → web/dist/
bun run preview                  # serve the production build locally
```

`vite.config.ts` sets `base: './'`, so `web/dist/` can be copied as-is to GitHub Pages
(or any static host / sub-path). The wasm binary is served as a plain asset and loaded
inside the Web Worker via `fetch`, so no special headers are needed.

## Test

```sh
bun run test                     # vitest: event buffer, particle interpolation, tx-stage reducer
bunx playwright install chromium # once
bun run e2e                      # Playwright smoke test (starts the dev server itself)
```

The smoke test (`e2e/smoke.spec.ts`) loads the page, selects `happy-path`, plays at 20×
and asserts the Transaction panel shows a finalized time for Alpenglow, then writes
`e2e/screenshots/happy-path.png`.

## Architecture

```
┌──────────────────────────── main thread ─────────────────────────────┐
│                                                                      │
│  React (zustand store)          Controller (rAF loop, no React)      │
│  ┌──────────────┐  set() ≤15Hz  ┌─────────────────────────────────┐  │
│  │ TopBar       │◀──────────────│ displayTime += dt × speed       │  │
│  │ Inspector    │               │ clamp to min(worker.now)        │  │
│  │ Timeline     │── seek/play ─▶│ per run:                        │  │
│  └──────────────┘               │   buffer.drain(displayTime)     │  │
│                                 │   → applyEvents(view)  (panels) │  │
│  Pixi Scene(s) ◀── emit/update ─│   → scene.emit(msg_sent)        │  │
│  nodes · leader ring · dividers │   look-ahead: advance(t+300ms×s)│  │
│  ParticleSystem (pooled, ≤6000) │   poll inspect()/metrics() 5 Hz │  │
│                                 └────────────┬────────────────────┘  │
└──────────────────────────────────────────────┼───────────────────────┘
                     postMessage {init|advance|step|reset|inspect|metrics}
                                               ▼
┌──────────── Web Worker per protocol (engine/worker.ts) ──────────────┐
│  wasm `Sim(protocol, scenarioJson)`                                  │
│  runUntil(t) → JSON Traced[]  ·  inspect(node)  ·  metrics()         │
│  reset(t): new Sim + runUntil(t)  (engine is deterministic)          │
└──────────────────────────────────────────────────────────────────────┘
```

Key ideas:

- **One display clock, N workers.** Compare mode runs an Alpenglow worker and a Tower
  worker from the same scenario JSON and seed; both are driven by the same
  `displayTime`. The clock never outruns a worker — it stalls instead of skipping events.
- **Time-indexed event buffer** (`engine/eventBuffer.ts`). Workers pre-compute ~300 ms
  (× speed) of sim time ahead. Each frame the controller *drains* the events whose `t`
  has been passed by the display clock; those events (and only those) update the derived
  `RunView` used by the panels and spawn particles. Panels therefore always agree with the
  canvas about "now".
- **Scrubbing.** Forward: the clock jumps, buffered events drain, particles already
  arrived are skipped (`isVisibleAt`). Backward: the worker re-creates the Sim and
  fast-forwards to the target (`reset`); the main-thread buffer and view are rebuilt from
  the returned events, again suppressing particles that would already have landed.
- **Particles** (`render/particles.ts`) are pooled `Particle`s in Pixi `ParticleContainer`s
  — no DOM per message. Position is a quadratic bezier (slight arc, always to the left of
  travel so both directions stay legible). Dropped messages fizzle at 60 % of the path.
  `prefers-reduced-motion` lowers the cap to 1500 and disables glow.
- **Colour** is reserved for message identity (shred blue, vote aqua, certificate gold,
  repair grey; the hero tx is a white glow). The palette was validated CVD-safe against
  the canvas surface with the dataviz validator; nodes stay neutral so traffic pops.

### Files

```
src/
  engine/   types.ts (contract mirror) · protocol.ts · worker.ts · client.ts
            eventBuffer.ts · txStages.ts · controller.ts · wasmMain.ts
  render/   colors.ts · layout.ts · interp.ts · particles.ts · scene.ts · CanvasView.tsx
  store/    useStore.ts (zustand) · runView.ts (event → view reducer)
  components/ TopBar · Timeline · Inspector · ScenarioModal
              panels/ Transaction · Votor · Tower · Events · Metrics
              charts/ TallyBar · LockoutBars · ForkTree · StatTile
test/     vitest unit tests        e2e/  Playwright smoke test + screenshots
```

### Contract notes (docs/wasm-api.md vs actual bindings)

- `builtinScenario(name)` returns `string | undefined` (doc: `string`).
- `block_produced` carries an undocumented `vote_txs` field; under Tower its `txs` list
  does not include the hero tx id, so the UI derives the hero block from the
  `tx_stage: included_in_block` event's slot instead.
- `Sim.protocol()` exists in the bindings but is undocumented.
- `inspect(node).pool` (Alpenglow) contains `null` entries for slots the node holds no
  tally for; the UI filters them. Tower `inspect().forks` entries carry extra `leader` and
  `replayed` fields.
- `certificate.stake_pct` is a fraction (0–1) while pool tallies use percent (0–100).
- `hash` values are u64 serialised as JSON numbers, so they lose precision past 2^53 and
  their low hex digits come out as `000`. The UI compares them for equality only and shows
  the *leading* 4 hex digits (the doc suggests the trailing 4, which are all zeros).
- `metrics()` is computed over everything the worker has produced, i.e. up to ~300 ms
  (× speed) ahead of the display clock.

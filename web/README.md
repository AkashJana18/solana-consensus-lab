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
bun run test                     # vitest: event buffer, interpolation, tx stages, URL state, triggers, markdown, lesson registry
bunx playwright install chromium # once
bun run e2e                      # Playwright (starts the dev server itself); also runs in CI
```

- `e2e/smoke.spec.ts` loads the page, selects `happy-path`, plays at 20× and asserts the
  Transaction panel shows a finalized time for Alpenglow, then writes `e2e/screenshots/happy-path.png`.
- `e2e/compare.spec.ts` does the same for `leader-down` in Compare mode.
- `e2e/lesson.spec.ts` follows the *Skip certificates* lesson end to end: intro, auto-run step,
  predict → run → reveal, Back to a recorded stop, outro, finish.
- `e2e/share.spec.ts` opens a share link, checks every field was restored, and reads the link
  the Share button copies to the clipboard.

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
- **Breakpoints** (`engine/breakpoint.ts`, `Controller.setBreakpoint`). A lesson step names a
  declarative `Trigger`; each frame the controller computes the clock target, and *before*
  advancing scans `EventBuffer.range(displayTime, target)` of the watched run for the first
  matching event and clamps the target to its exact `t`. The stop is therefore frame-exact
  at any speed with no rewind. `time` triggers and `deadlineUs` clamp to an absolute time.
  While a run is `resetting` after a backward seek the clock is held.
- **URL state** (`url/state.ts`, `url/sync.ts`). `?scenario=…&seed=…&mode=…&t=<ms>&node=…&tab=…&speed=…&lesson=…&step=…`;
  a custom scenario is deflate-raw + base64url in `s=`. `App` hydrates the store from the URL
  before the first `configure()` and seeks to `t` once it resolves; `startUrlSync` mirrors the
  store back with a debounced `replaceState`, writing `t` only while the clock is paused.

## Lessons

A lesson is a plain TypeScript object (`src/lessons/types.ts`) registered in
`src/lessons/index.ts`:

```ts
export const skipCerts: Lesson = {
  id: 'skip-certs', title: '…', summary: '…', minutes: 4,
  scenario: 'leader-down', mode: 'alpenglow', seed: 1, speed: 1,
  intro: `markdown…`,
  steps: [
    { id: 'offline', title: '…', protocol: 'alpenglow', trigger: { type: 'node_offline' }, body: `…` },
    { id: 'skip-cert', title: '…', protocol: 'alpenglow', trigger: { type: 'certificate', kind: 'skip' },
      tab: 'votor', selectNode: 'hit',
      lead: `shown before the run`, question: { prompt, choices, answer, explain }, body: (hit, view) => `…` },
  ],
  outro: `markdown…`,
};
```

- `trigger` is one of the `Trigger` variants in `engine/breakpoint.ts` (`tx_stage`, `certificate`,
  `pool_event`, `votor_flag`, `timeout`, `node_offline`, `partition_start/end`, `block_produced`,
  `tower_update`, `commitment`, `log`, `time`). `deadlineUs` stops anyway if it never fires.
- `body` may be a function of the hit event and the run's `RunView`, so copy can quote the
  actual slot, stake or metric. `lead` is shown before the stop; a step without a `question`
  runs as soon as it is entered.
- Text is a small markdown subset (`lessons/markdown.ts`): paragraphs, `## ` headings,
  `- ` bullets, `**bold**`, `` `code` ``, `[text](url)`.
- `lessons/runner.ts` drives the store and controller; `components/LessonPanel.tsx` renders the
  left column. `test/lessons.test.ts` checks every lesson's scenario exists and steps are well-formed.
- Verify timings with the CLI before writing copy, e.g.
  `cargo run -p sim-cli -- run --scenario leader-down --protocol alpenglow --events 100000 --only certificate,pool_event`.

### Files

```
src/
  engine/   types.ts (contract mirror) · protocol.ts · worker.ts · client.ts
            eventBuffer.ts · txStages.ts · controller.ts · breakpoint.ts · wasmMain.ts
  render/   colors.ts · layout.ts · interp.ts · particles.ts · scene.ts · CanvasView.tsx
  store/    useStore.ts (zustand) · runView.ts (event → view reducer)
  url/      state.ts (parse/format/compress) · sync.ts (store ⇄ address bar, share link)
  lessons/  types.ts · markdown.ts · runner.ts · index.ts · one lesson per file
  components/ TopBar · Timeline · Inspector · ScenarioModal · LessonPanel · LessonPicker · Markdown
              panels/ Transaction · Votor · Tower · Events · Metrics
              charts/ TallyBar · LockoutBars · ForkTree · StatTile
test/     vitest unit tests        e2e/  Playwright specs + screenshots
```

### Contract notes (docs/wasm-api.md vs actual bindings)

- `builtinScenario(name)` returns `string | undefined` (doc: `string`).
- Under Tower, `block_produced.txs` does not include the hero tx id, so the UI derives the
  hero block from the `tx_stage: included_in_block` event's slot instead. `vote_txs` on the
  same event is the count of vote transactions packed (0 under Alpenglow).
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

# Changelog

A running record of what this project has gained and why, newest first. Grouped by the day
the work landed rather than by release version, because there are no tags yet. Entries name
the area they touch so you can go straight to the diff.

Companion documents, not duplicated here: [`CLAUDE.md`](CLAUDE.md) for commands and the
invariants that are load-bearing, [`docs/architecture.md`](docs/architecture.md) for the
module map and the explicit list of what is modelled versus simplified.

## 2026-10-10

- **A live devnet mode, on a click.** A fourth mode watches a real transaction on
  `api.devnet.solana.com` and renders it through the same timeline, transaction stepper and
  events feed the simulated runs already use. Alpenglow is live on devnet and testnet and is
  not yet live on mainnet, confirmed on-chain rather than from a blog post: `getAgGenesisCert`
  returns a genesis certificate on devnet (slot 504,148,999) and on testnet (444,625,255), and
  `null` on mainnet-beta. The simulator shows the mechanism; this shows the outcome.

  It emits the existing `Traced` union rather than a parallel path, behind a new `RunSource`
  interface that `SimClient` already satisfies, so everything the UI reads still comes from a
  trace event. `web/src/engine/liveClient.ts` is now the second producer of that stream.

  **Polling waits for Start.** The first version began from `?mode=live`, which meant any shared
  link sent every visitor to Solana at roughly 1.4 requests a second before they had touched
  anything. The endpoint is free tier and shared by everyone (150 requests/10s per IP), so one
  tab was about a third of a stranger's budget. `init()` now resolves meta and returns without a
  request; `start()` owns the loop, and Stop stops asking.

  Three things are not observable and are never faked. SIMD-0326 keeps Alpenglow votes as
  off-chain gossip, so notarization votes, certificates, Pool events, Votor flags and Rotor
  relay choice are invisible to any outside observer; `getAlpenglowVoteAccounts`,
  `getVotorState` and `getAlpenglowStats` all return "Method not found", and that is structural
  rather than a gap in this implementation. What is visible is emitted: slots, blocks, skipped
  slots, commitment levels, and the block's own `blockTime`. `docs/wasm-api.md` carries the
  table.

  The poll loop cannot die quietly. A tick that overlapped an in-flight poll used to return
  before the `finally` that re-arms the timer, so one slow request left the trace stopped with
  no error and nothing in the feed; `rpc()` also had no deadline and no abort. Both fixed, plus
  15% jitter on the interval (so N tabs do not retry in lockstep against a per-IP limit), a
  `visibilitychange` handler that parks a hidden tab, and a bounded `seenSlots`.

- **A `devnet-shape` scenario, built from a measurement.** The other six scenarios illustrate a
  protocol decision; this one starts from two numbers checked against devnet on 7 Oct 2026: a
  slot every ~250 ms, and a block in all 1,989 sampled slots, so no Skip certificate was
  externally visible then. `slot_ms` is pinned to 250 and no faults are taken off. A test
  asserts no Skip certificate forms and that blocks equal slots started, so a later parameter
  change cannot quietly turn a lesson about "every slot produces a block" into a lesson about
  something else.

  Worth recording because it nearly went the other way: the first cadence measurement came out
  at 4,165 ms/slot, thirty times off, because a script had slots-per-second and
  milliseconds-per-slot inverted.

- **A lesson on the limit of observation.** "Observed vs modeled" runs `devnet-shape` and puts
  a modeled run beside a real devnet trace. Both show blocks and skipped slots, and only the
  model shows votes, notarization and certificates. Every trigger was confirmed against the CLI
  trace first: the first block at 0.0 ms, the first `block_notarized` Pool event at 407.4 ms,
  the first fast-finalization certificate at 418.1 ms, and the transaction finalized at 592.0 ms.
  Two triggers had to be corrected against the real types: `block_produced` takes no slot
  argument, and there is no `notarize` PoolEventKind, it is `block_notarized`.

- **Sending on devnet, and the wallet path fixed.** The live panel could only trace a signature
  that already existed, so it now builds a System transfer, has the wallet sign it, broadcasts
  itself, and traces the result. It asks the wallet to *sign* rather than to sign-and-send, so a
  wrong cluster or an expired blockhash is reportable instead of a transaction that silently
  never lands. The app never sees a key.

  Two defects fixed on the way. The Connect button was gated on the legacy `window.solana`
  provider while signing went through Wallet Standard, so a wallet that speaks only the standard
  never saw the button at all. And `devnetSend.ts` imported `mergeBytes` from a package that is
  not a declared dependency, resolving only through hoisting while Vercel installs with
  `--frozen-lockfile`; the four lines that concatenate two byte arrays now live locally.

  Wallet Standard keys features by their fully qualified name, `solana:signTransaction`, not
  under a `solana:` namespace object. The module read the namespace form and reported "no
  wallet" for a wallet that was present and willing. The unit tests had passed throughout,
  because their mock was written from the same misreading; the e2e mock, written against how a
  real extension registers, is what caught it.

- **The top bar thresholds, re-measured.** Every CI run on `main` since 5 Oct failed the same
  assertion: the document scrolled sideways at 1100px, 1112 > 1100. The thresholds were never
  wrong on the machine they were measured on; they were wrong on the machine that runs the
  tests, and nothing in the repo said so. The Linux CI renderer lays the same bar out about
  48px wider than macOS. Both figures were read off a developer machine and never re-run, and
  the claimed margins did not survive arithmetic: `1064 + 36` is not `1100`.

  The label threshold had no test at all, because `WIDTHS` topped out at 1440, inside the band
  the rule collapses. `web/scripts/measure-topbar.ts` (`bun run measure:topbar`) is now the
  measurement the CSS comments had been asking for in prose, and it names descendants whose
  `scrollWidth` exceeds their `clientWidth`, which `.segmented` hides behind `overflow: hidden`.

  Then the second half, which is the part worth remembering. Adding the Devnet button pushed
  the bar 150px wider on the runner, and it began failing at exactly one width: 1440, where it
  needed 1444. 1300 fitted. 1500 fitted. That shape is the tell: a bar that fits on both sides
  of a viewport is not a bar needing a narrower breakpoint, it is a threshold sitting in the
  wrong band. The field labels and padding were being shed at 1400 and not above it, so 1440
  was the one viewport wide enough to need that help and too narrow to have received it. The
  compaction now starts at 1450.

  Measuring it needed the machine that enforces it. macOS and the Linux runner resolve
  `system-ui` to fonts that disagree by a couple of hundred pixels across this bar: the local
  measurement said 1229px, the runner said 1444. Every threshold in this file was chosen from a
  developer machine and none of them were checked against the runner, which is why the margins
  written into the comments did not survive arithmetic and then did not survive CI.

## 2026-10-07

- **Google Analytics, off unless configured.** GA4 is installed by `web/src/analytics.ts` from
  `VITE_GA_ID`, with nothing inlined in `index.html`, so a developer's clone sends nothing to
  the production property. Unset is the default and installs no tag at all, and an id that is
  not shaped like a GA4 measurement id is refused rather than injected: a typo shipped as a
  live script tag collects nothing silently and for ever. `web/.env.example` documents the
  variable, `web/.env.local` stays gitignored, and production sets it in the Vercel project.
  Because the id is baked in at build time, changing it needs a rebuild rather than a redeploy.
  Vercel Analytics continues to run alongside and the two are independent.

## 2026-10-05

- **README rewritten in plain English**, 126 lines and 1,578 words down to 97 and 672. The
  protocol internals, the scenario field reference, the share-link format and the architecture
  diagram all moved behind links to `docs/`, since those already covered them. The measured
  latency table and the 451 ms versus 150 ms explanation stayed: they are the strongest
  evidence the project has.
- **Source link in the top bar** with a live star count read from `api.github.com`. Cached for
  an hour, backed off to GitHub's own `x-ratelimit-reset` on a 403 or 429, and skipped under
  automation so the suite spends no third-party quota and logs no console error. The bar's
  label collapse became two thresholds to fit the extra 73px. New `web/e2e/repo-link.spec.ts`.
- **Link previews.** `og:` and `twitter:` meta in `web/index.html` with absolute URLs, plus a
  `description` and `canonical`. Static by necessity: the app is a client-rendered SPA with no
  SSR, so every share link (`?scenario=...&mode=compare&t=2700`) gets the same card even though
  each lands on a different moment. `og:url` is the bare domain on purpose, since the query
  string is a moment rather than a different page.
- **A 1200x630 preview card** at `web/public/og.png`, rendered by `scripts/make-og.mjs` from the
  vector mark and the brand gradient. Hand-run, never part of the build; the PNG is committed.
  The 4:1 banner cannot be used for a card, because a centre crop to 1.91:1 keeps only the
  middle 48% of its width, cutting the mark and the end of the wordmark, and its photograph has
  the wordmark baked in, so no clean region can be lifted from it either.
- **The banner now leads the README**, as `web/public/scl-banner.png`.
- **Em-dashes removed from prose** across the six markdown files, from code comments, and from
  the three user-visible sentences that used one. The `'—'` that stands for "no value" in the
  inspector tables and the CLI's stage table is deliberately left alone: it is a typographic
  blank rather than punctuation, and changing it would alter what a learner reads.
- **This changelog.**

> The preview tags went live with the domain's first deploy after this landed. X caches
> previews hard, so re-share a link to see them, and expect a cache-bust (`og.png?v=2`) if the
> card ever changes. The GitHub social preview is still a manual step in repository settings.

## 2026-10-04

- **The SCL mark is now in the top bar and is the favicon**, credited in the README as this
  project's own rather than a Solana Foundation asset.
- **Toolbar controls are named** for hover and focus. The icon-only labels had no accessible
  name at all, because `display: none` takes a button's only text out of the tree with it.
- **The product name survives down to 1100px** instead of the bar clipping its own readout.
- Fixed a tooltip spec racing its own hover delay.

## 2026-10-03

A pass for accessibility, performance and small screens, after the first read of the app on a
laptop that is not a 1440px monitor.

- **Accessibility.** A focus ring that was invisible on most controls (the UA default was being
  suppressed); Escape, a focus trap and focus restore on both dialogs; global shortcuts no
  longer hijacking a focused control; validators selectable from the keyboard; the canvas given
  an accessible name.
- **Performance.** Components subscribe to the fields they render instead of the whole run, so
  a running simulation stops reconciling the whole toolbar 15 times a second. The timeline
  rebuilds only the playhead, not the whole SVG.
- **Responsive.** The layout stacks below 1024px instead of clipping the inspector off-screen;
  the tab strip no longer pushes the document sideways; the events feed sizes to its own
  viewport; top bar labels collapse before the readout can be clipped.
- **Lessons.** Exiting a lesson restores the learner's previous setup; a lesson link no longer
  carries a stale `t`; the compressed-scenario cache is bounded and impossible nodes dropped.
- Deleted code nothing calls and one selector that could never match. Documented the Vercel
  deploy and added contributor ground rules. Dropped the GitHub Pages deploy job.

## 2026-10-02

- **The `ideal` scenario**, where the transaction rides the block's last slice so Alpenglow
  finalizes it in 150 ms. It is what makes the paper's headline figure reproducible here, and a
  test pins the number. Renamed from `ideal-fast`.
- Corrected `happy-path`'s copy to match the measured trace rather than the assumption it
  started from.
- Added `docs/architecture.md`, and rendered the README diagrams as Mermaid.

## 2026-09-30

- The canvas resizes with layout changes, not only with window resize.

## 2026-09-25

- Deployed the web app to Vercel with analytics.

## 2026-09-24

- **Alpenglow liveness fixes:** standstill recovery, a validator's stake counting once towards
  a Skip certificate, and stake-proportional Rotor relay sampling. Also fixed the fault picker
  overshooting onto a 95% whale, and the hero transaction being lost when it landed in an
  Alpenglow slot whose leader was dead.
- **Lesson mode**, with breakpoints that land on the exact trace event, URL state, and share
  links that restore scenario, seed, mode, time, node and tab.
- Surfaced TowerBFT's vote-transaction block-space cost in the metrics tab.
- End-to-end specs for lessons and share, plus Playwright and CI hardening.

## 2026-09-23

- **v0.1:** the Alpenglow versus TowerBFT comparison, as a deterministic discrete-event
  simulator with a web UI and a headless CLI.

## If you are an agent picking this up

- Read [`CLAUDE.md`](CLAUDE.md) before changing anything. It holds the commands, the module
  split, and a list of modelling decisions that look like bugs but are not.
- [`docs/architecture.md`](docs/architecture.md) is the contributor map: module by module,
  where to add things, and what the model deliberately leaves out.
- **Determinism is a hard invariant.** Same scenario and seed must give a byte-identical
  trace. Do not use `HashMap` ordering anywhere that affects behaviour.
- **Everything observable is a trace event.** If the UI needs to show something new, add an
  event and mirror it in `web/src/engine/types.ts` and `docs/wasm-api.md`, never a side channel.
- **Scenario timings are the contract.** Lesson copy has to match the measured trace, so check
  timings with the CLI rather than editing the words by hand.
- **The top bar is width-budgeted to the pixel.** `global.css` records the measurements and how
  to re-measure after touching it.
- Keep commits modular and write them in detail.
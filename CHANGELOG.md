# Changelog

A running record of what this project has gained and why, newest first. Grouped by the day
the work landed rather than by release version, because there are no tags yet. Entries name
the area they touch so you can go straight to the diff.

Companion documents, not duplicated here: [`CLAUDE.md`](CLAUDE.md) for commands and the
invariants that are load-bearing, [`docs/architecture.md`](docs/architecture.md) for the
module map and the explicit list of what is modelled versus simplified.

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
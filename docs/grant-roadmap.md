# Grant roadmap: from v0.1 to a curriculum-grade tool

This document is written to be lifted into a Superteam microgrant or Solana
Foundation public-goods application. It states the public good, the audience,
the milestones, and how each milestone is verified.

## The public good

Alpenglow (SIMD-0326, approved Sept 2025, community test cluster since May 2026,
mainnet targeted Oct 2026 via Agave 4.3) is the largest consensus change in
Solana's history, and every course that teaches "Proof of History + TowerBFT"
is about to be out of date. There is no interactive, side-by-side, protocol-
faithful explanation of the change. Anza's reference repository ships a
headless latency/bandwidth simulation with no UI and no TowerBFT comparison.

Solana Consensus Lab is Apache-2.0, runs entirely in the browser (no backend,
no wallet, no cost), embeds in any course page, and its simulation core is a
deterministic Rust library that researchers can drive from the CLI.

## Audiences and how each uses it

| Audience | Use |
|---|---|
| Ackee **School of Solana** (lecture 1: PoH, Sealevel, fundamentals) | Replace static slides on PoH/TowerBFT with the embedded happy-path + leader-down scenarios; homework: "find the smallest Δtimeout that still never skips a healthy leader". |
| **Turbin3** builders & advanced cohorts | Pre-work module on commitment levels (`processed`/`confirmed`/`finalized`) and why RPC `finalized` moves from ~12.8 s to ~150 ms — directly relevant to app UX decisions. |
| **Solana School** (Lesson 1 covers architecture, PoH and Alpenglow) | Shareable links to exact moments (e.g. "the Skip certificate forms here") inside lesson text. |
| **Rektoff** / security-focused programs | Attack-lab scenarios: equivocation, double votes, the 20% double-sign wall, Tower lockout violations and switching proofs. |
| Validators, Anza, researchers | CLI sweeps (timeout, offline stake, relay count) exported to CSV; deterministic traces for bug reports. |

## Milestones

### M1 — v0.1 (done in this repository)
- Deterministic engine, both protocols paper-faithful, four fault scenarios.
- Web UI with side-by-side compare, inspectors, timeline; CLI with run / inspect / replay / sweep.
- Tests: unit, property-based safety & liveness, determinism; CI; GitHub Pages deploy.
- **Verify:** `cargo test --workspace`; open the deployed site; hero tx finalizes in both protocols.

### M2 — Lesson mode + shareable moments (done in this repository)
- Guided lessons (TypeScript modules, `web/src/lessons/`): "One transaction, two protocols", "Why votes on-chain cost block space", "Skip certificates", "Lockouts and why partitions hurt TowerBFT", "20+20" (offline arm; the adversarial arm waits for M4's Byzantine faults).
- Each lesson pauses the simulation on the exact trace event of each step (a breakpoint clamps the display clock before it advances) with an explainer and a *predict-then-run* question.
- URL state: scenario (or compressed custom JSON) + seed + mode + time + selected node + tab + lesson step; the Share button copies it.
- Engine fixes surfaced by the lessons: standstill recovery after partitions, Skip-certificate stake counted once per validator, stake-proportional Rotor relay sampling, re-forwarding of transactions from skipped blocks, a fifth builtin scenario.
- **Verify:** `bun run e2e` follows the Skip-certificates lesson end-to-end and restores a share link (also in CI); instructor review from at least one program is still open.

### M3 — Embeddable widget + instructor pack (≈ 2 weeks)
- `<consensus-lab scenario="leader-down" protocol="compare">` web component and an iframe URL scheme; theme tokens for host sites; `prefers-reduced-motion` support.
- Instructor pack: slide deck (PDF + source), exercise sheets with answer keys, a one-page "what changes for app developers" handout.
- **Verify:** widget embedded in a School of Solana or Turbin3 page (or a demo course site); pack reviewed by an instructor.

### M4 — Attack lab (≈ 3 weeks)
- Byzantine behaviours as scenario flags: equivocating leader (two blocks per slot), double-voting validators, shred-withholding relays, vote-censoring leader (Tower only).
- Slider over Byzantine stake showing the 20% double-sign wall: below it no conflicting certificates can form; above it the UI surfaces the slashable evidence (two certificates for one slot).
- TowerBFT counterparts: lockout-violation detector, switching-proof visualization, long-range partition.
- **Verify:** property tests assert no conflicting finalization below 20% Byzantine; scenarios documented; review by a security program.

### M5 — Realism + research features (≈ 3 weeks)
- Import mainnet stake and validator geography (RPC `getVoteAccounts` snapshot + public geo data) and a measured inter-region latency matrix.
- Rotor vs Turbine explorer: per-node bandwidth, hops, resilience to relay failure, with mainnet-scale shred counts (64/32).
- Parameter sweeps in the UI (Δtimeout, offline %, relays, fanout) with charts; CSV export; trace import for bug reports.
- Optional: Stateright model of the Votor state machine for exhaustive small-model checking.
- **Verify:** reproduces the paper's qualitative latency distribution on a mainnet-like set; sweep charts in the UI.

### M6 — Live mode + community (≈ 2 weeks)
- Read real slot/commitment progression from an RPC endpoint (mainnet or the Alpenglow test cluster) alongside the simulation.
- i18n (Hindi, Vietnamese, Spanish, Turkish, Portuguese for Superteam regions); a11y pass; analytics for usage metrics.
- **Verify:** live panel tracks a public endpoint; two translations complete.

## Budget shape (indicative)

Milestone-based, one maintainer plus review honoraria for instructors:
M2–M3 fit a Superteam microgrant (≤ $10k); M4–M6 fit a Solana Foundation
public-goods grant. Deliverables are public on every milestone; releases are
tagged; metrics reported: unique users, embeds, GitHub stars/forks, curriculum
adoptions, lessons completed.

## Why this project is credible

- Protocol logic follows the Alpenglow white paper v1.1 and SIMD-0326, and Agave's `vote_state` for TowerBFT, with the exact flag names and thresholds visible in the UI.
- Property-based tests check safety (no conflicting finalization) and liveness (≤ 20% offline) over random seeds; the same seed reproduces a byte-identical trace on every machine, including in the browser.
- Everything shown is derived from the simulation trace — the animation cannot lie about the protocol.

## Timing

Ship M2–M3 before the October 2026 mainnet activation, when attention on
"what is Alpenglow" peaks, and offer the tool to Anza/Solana Foundation for
their upgrade communication.

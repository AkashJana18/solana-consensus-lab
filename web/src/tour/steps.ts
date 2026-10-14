// The component tour's content: what gets highlighted, and what it does.
//
// Each step is ONE control plus one explanation. That is a hard rule, not a style choice:
// an earlier version of this file let a step target several selectors at once, and the one
// that paired `lessons-open` with `share` drew a single ring spanning the `?` button and the
// whole transport row between them, which read as three controls clipped into one box. The
// target is a plain `string` rather than `string | string[]` so that mistake cannot be made
// again. A selector may still match more than one element (the canvas exists once per
// protocol in Compare mode) and those are unioned, because that is one logical thing shown
// twice rather than two different things.
//
// Nothing here changes the application: the tour points at a control and says what it does,
// and Next only ever moves the highlight. That restraint is why the list can be reviewed
// without running the app.

export interface TourStep {
  id: string;
  /**
   * The heading the card shows: the name of the control being explained.
   *
   * This was a chapter name, and it was the wrong level. Ten steps in the top bar all
   * read "TOP BAR", so the eyebrow said nothing about which button the card was about and
   * the step number was the only thing telling two adjacent stops apart. Naming the
   * component makes the heading carry its weight, and it is what a reader scans for.
   */
  label: string;
  /** Exactly one CSS selector. See the note above on why this is not an array. */
  target: string;
  text: string;
}

/**
 * The steps in reading order: top bar left to right, then the canvas, then the right-hand
 * inspector column, then the timeline along the bottom.
 *
 * The order is not a matter of taste. It falls out of the layout in global.css:
 * `.app` is `grid-template-rows: 52px 1fr 100px`, `.main` is
 * `grid-template-columns: 1fr 400px`, and `.topbar` is a flex row, so within a row the DOM
 * order *is* the visual order. Within the canvas cell the caption is `position: absolute;
 * top: 10px` and the legend is `bottom: 10px`, so caption-then-legend is top-to-bottom
 * around the canvas they annotate.
 *
 * It used to start at the protocol mode, jump back left to the scenario, run right along
 * the transport, then jump back left again for Lessons and Share, list the legend above the
 * caption that sits above it, and put the timeline in the middle of the list rather than at
 * the bottom. test/tour.test.ts pins this sequence, because the array order *is* the
 * reading order and nothing else about it is checkable from the source.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  // ---- top bar, left to right ------------------------------------------------------------
  {
    id: 'scenario',
    label: 'Scenario',
    target: '[data-testid="scenario-select"]',
    text: 'Which network to simulate: the fault pattern, the region layout, and when the transaction lands. Each one has a description underneath.',
  },
  {
    id: 'mode',
    label: 'Protocol mode',
    target: '[data-tour="mode"]',
    text: 'Which protocol to run. Alpenglow, TowerBFT, or Compare for the two side by side. Compare is the honest way to compare them: same network, same latencies, same stake, different consensus.',
  },
  {
    id: 'seed',
    label: 'Seed',
    target: '[data-tour="seed"]',
    text: 'Fixes every random choice in the run: which nodes lead, who relays, how messages interleave. Same scenario plus same seed gives the same run every time. Change it to find out how much of what you just saw was luck.',
  },
  {
    id: 'lessons',
    label: 'Lessons',
    target: '[data-testid="lessons-open"]',
    text: 'Guided lessons. Each one loads a scenario, pauses at the moments that matter, and asks you to predict what happens before running.',
  },
  {
    id: 'share',
    label: 'Share',
    target: '[data-testid="share"]',
    text: 'Copies a link to exactly this moment: scenario, protocol, seed, selected node, and the clock if you are paused. If a lesson is open the link carries the step too, so a student lands where you stopped.',
  },
  {
    id: 'play',
    label: 'Play',
    target: '[data-testid="play"]',
    text: 'Runs the clock. Nothing moves until you press it, and the engine only ever advances as far as the display clock asks for.',
  },
  {
    id: 'step-event',
    label: 'Step one event',
    target: '[data-testid="step-event"]',
    text: 'Advance by exactly one engine event, the finest grain the trace has. This is how you walk a single message from send to receipt without anything else happening around it.',
  },
  {
    id: 'step-slot',
    label: 'Step one slot',
    target: '[data-testid="step-slot"]',
    text: 'Jump forward one 400 ms slot, which is one leader window. Use it to skip the boring stretch in the middle of a scenario and land on the next decision.',
  },
  {
    id: 'speed',
    label: 'Speed',
    target: '[data-testid="speed"]',
    text: 'Playback rate, from 0.1x to 20x. It changes how fast you watch, never the simulation: same scenario and seed give the same trace either way.',
  },
  {
    id: 'readout',
    label: 'Clock',
    target: '[data-testid="readout"]',
    text: 'Where you are in simulated time, and which slot that is. The clock never outruns the engine: if the worker falls behind, playback stalls rather than skipping events.',
  },

  // ---- the canvas, then the two things annotating it (caption above, legend below) -------
  {
    id: 'caption',
    label: 'Canvas readout',
    target: '[data-tour="caption"]',
    text: 'The current slot, who is leading it, and which node you have selected. Compare mode runs the same scenario on both sides, so the two captions drift apart once the protocols start to disagree.',
  },
  {
    id: 'canvas',
    label: 'Network',
    target: '[data-tour="canvas"]',
    text: 'One circle per validator. Size is proportional to stake, position is region. The amber ring is the leader for this window. Click any circle to select that node.',
  },
  {
    id: 'legend',
    label: 'Legend',
    target: '[data-tour="legend"]',
    text: 'What the moving dots are: shreds, votes, certificates, repair requests, and the hero transaction in white. Colour is the message type.',
  },

  // ---- the inspector column, top to bottom -----------------------------------------------
  {
    id: 'node-picker',
    label: 'Node picker',
    target: '[data-testid="node-picker"]',
    text: 'Select a validator by number. This is the only way into the Votor and Tower panels, which show one validator’s votes and lockouts rather than the network’s.',
  },
  {
    id: 'transaction',
    label: 'Transaction',
    target: '[data-testid="tx-stepper"]',
    text: 'The eight stages the hero transaction passed through, first time any node reached each. One column per protocol in Compare mode. The latency table underneath is measured from inclusion, because that is what isolates consensus from when the transaction landed in the block.',
  },
  {
    id: 'votor',
    label: 'Votor',
    target: '[data-testid="tab-votor"]',
    text: 'Alpenglow only, so this tab appears in Alpenglow and Compare mode. It shows which votes the selected validator has pooled per slot: notarize, skip, or both. The dashed lines are the 20 / 40 / 60 / 80 % stake thresholds where a certificate can form. Watching a bar cross 60 % is watching notarization happen.',
  },
  {
    id: 'tower',
    label: 'Tower',
    target: '[data-testid="tab-tower"]',
    text: 'TowerBFT only. Each row is a vote in the selected validator’s tower, and bar length is the lockout, on a log scale from 2^1 to 2^31. The dashed row is the depth-8 fork-switch check, which needs two thirds of stake. Rooting happens much further down, at depth 32.',
  },

  // ---- the timeline, the bottom row of the whole window ----------------------------------
  {
    id: 'timeline',
    label: 'Timeline',
    target: '[data-testid="timeline"]',
    text: 'The whole run at a glance, and the only control you can drag. Each band is a leader window, labelled L4; the tinted overlays are the active faults; the ticks are slots. The two rails underneath mark the hero transaction stages per protocol, which is where you can see the gap open up.',
  },
];

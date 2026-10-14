import { describe, expect, it } from 'vitest';
import { protocolsFor, type Mode } from '../src/store/useStore';
import { GAP, MARGIN, NEEDS_BELOW, POPOVER_WIDTH, boxOf, caretAnchor, clamp, place, sideFor, unionBox, type Box } from '../src/tour/placement';
import { TOUR_STEPS, visibleSteps } from '../src/tour/steps';

const box = (top: number, left: number, width: number, height: number): Box => ({ top, left, width, height });
const VIEWPORT = { width: 1440, height: 900 };

describe('unionBox', () => {
  it('returns null when there is nothing to point at', () => {
    expect(unionBox([])).toBeNull();
    // A hidden element reports 0x0, which is what `display: none` gives us. Two of them
    // must not union into a box at the origin, or the ring would point at the top-left
    // corner and look like a bug.
    expect(unionBox([box(0, 0, 0, 0), box(0, 0, 0, 0)])).toBeNull();
  });

  it('returns null when every input is zero-size', () => {
    expect(unionBox([box(10, 10, 0, 40), box(50, 60, 30, 0)])).toBeNull();
  });

  it('drops zero-size rects but keeps the rest', () => {
    expect(unionBox([box(10, 20, 100, 40), box(0, 0, 0, 0)])).toEqual(box(10, 20, 100, 40));
  });

  it('unions several controls into one ring', () => {
    // The transport row is three separate buttons; the ring has to cover all three.
    const got = unionBox([box(14, 100, 40, 28), box(14, 146, 60, 28), box(14, 212, 52, 28)]);
    expect(got).toEqual({ top: 14, left: 100, width: 164, height: 28 });
  });

  it('unions rects that are not in document order', () => {
    const got = unionBox([box(300, 500, 20, 20), box(100, 50, 20, 20), box(200, 200, 20, 20)]);
    expect(got).toEqual({ top: 100, left: 50, width: 470, height: 220 });
  });

  it('returns a single rect unchanged', () => {
    const one = box(10, 20, 30, 40);
    expect(unionBox([one])).toEqual(one);
  });
});

describe('clamp', () => {
  it('keeps a value inside its bounds', () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('returns the low bound rather than a negative when the range is inverted', () => {
    // A viewport narrower than the popover plus both margins inverts the range. Without
    // this the card would get a negative width or an off-screen left edge.
    expect(clamp(5, 16, -20)).toBe(16);
  });
});

describe('sideFor', () => {
  it('prefers below when there is room', () => {
    expect(sideFor(box(100, 0, 100, 30), VIEWPORT, NEEDS_BELOW)).toBe('below');
  });

  it('goes above when below would not fit', () => {
    // Target near the bottom, as the timeline always is.
    expect(sideFor(box(840, 0, 100, 30), VIEWPORT, NEEDS_BELOW)).toBe('above');
  });

  it('treats exactly enough room as fitting', () => {
    const target = box(900 - NEEDS_BELOW - 30, 0, 100, 30);
    expect(sideFor(target, VIEWPORT, NEEDS_BELOW)).toBe('below');
  });
});

describe('place', () => {
  it('puts the card below and GAP away when there is room', () => {
    const p = place(box(100, 600, 120, 30), VIEWPORT, 200);
    expect(p.side).toBe('below');
    expect(p.top).toBe(130 + GAP);
  });

  it('puts the card above and GAP away when there is not', () => {
    const p = place(box(840, 600, 120, 30), VIEWPORT, 200);
    expect(p.side).toBe('above');
    expect(p.top).toBe(840 - GAP - 200);
  });

  it('centres horizontally on the target', () => {
    const p = place(box(100, 700, 100, 30), VIEWPORT, 200);
    expect(p.left).toBe(700 + 50 - POPOVER_WIDTH / 2);
  });

  it('pushes a target at the left edge inboard instead of off screen', () => {
    const p = place(box(100, 0, 40, 30), VIEWPORT, 200);
    expect(p.left).toBe(MARGIN);
  });

  it('pushes a target at the right edge inboard', () => {
    const p = place(box(100, 1400, 40, 30), VIEWPORT, 200);
    expect(p.left + POPOVER_WIDTH).toBeLessThanOrEqual(VIEWPORT.width - MARGIN);
  });

  it('never places a card off the top of a short viewport', () => {
    // Neither side fits; the card must still land on screen.
    const tiny = { width: 1440, height: 200 };
    const p = place(box(0, 600, 100, 30), tiny, 246);
    expect(p.top).toBeGreaterThanOrEqual(MARGIN);
  });

  it('narrows rather than overflowing on a narrow viewport', () => {
    const narrow = { width: 300, height: 800 };
    const p = place(box(100, 20, 100, 30), narrow, 200);
    expect(p.left).toBe(MARGIN);
    expect(p.left + POPOVER_WIDTH).toBeGreaterThan(narrow.width); // clamped, not laid out
  });
});

describe('caretAnchor', () => {
  it('points at the bottom edge when the card is below', () => {
    expect(caretAnchor(box(100, 20, 100, 40), 'below')).toEqual({ x: 70, y: 140 });
  });

  it('points at the top edge when the card is above', () => {
    expect(caretAnchor(box(100, 20, 100, 40), 'above')).toEqual({ x: 70, y: 100 });
  });
});

describe('boxOf', () => {
  it('reads the four fields the maths needs off a DOMRect', () => {
    const fake = { getBoundingClientRect: () => ({ top: 1, left: 2, width: 3, height: 4 }) } as Element;
    expect(boxOf(fake)).toEqual({ top: 1, left: 2, width: 3, height: 4 });
  });
});

describe('placement beside a tall target', () => {
  // The inspector panel at 1440x900: .main is `1fr 400px`, so the column spans x 1040-1440,
  // and .app rows are 52px / 1fr / 100px with .inspector rows auto / auto / 1fr, putting the
  // panel at roughly y 118-800. 682px tall against a 246px popover, so neither above nor
  // below fits and the card used to land squarely on top of it.
  const PANEL = box(118, 1040, 400, 682);

  it('puts the card to the left of the panel rather than over it', () => {
    expect(sideFor(PANEL, VIEWPORT, 246)).toBe('left');
  });

  it('clears the panel entirely, both horizontally and vertically', () => {
    const p = place(PANEL, VIEWPORT, 246);
    expect(p.left + POPOVER_WIDTH).toBeLessThanOrEqual(PANEL.left);
    expect(p.top).toBeGreaterThanOrEqual(MARGIN);
    expect(p.top + 246).toBeLessThanOrEqual(VIEWPORT.height - MARGIN);
  });

  it('centres the card on the shared edge rather than on the target', () => {
    // Centring on the target would place a card for a 400px-wide target at x=1080, which
    // both overlaps the panel and is nearly at the viewport edge.
    const p = place(PANEL, VIEWPORT, 246);
    expect(p.left).toBe(PANEL.left - GAP - POPOVER_WIDTH);
    expect(p.top).toBe(Math.round(PANEL.top + PANEL.height / 2 - 246 / 2));
  });

  it('goes right for a tall target with no room on its left', () => {
    const leftEdge = box(100, 0, 400, 682);
    expect(sideFor(leftEdge, VIEWPORT, 246)).toBe('right');
    expect(place(leftEdge, VIEWPORT, 246).left).toBe(leftEdge.left + leftEdge.width + GAP);
  });

  it('anchors the caret on the vertical centre of the shared edge', () => {
    expect(caretAnchor(PANEL, 'left')).toEqual({ x: 1040, y: 118 + 682 / 2 });
    expect(caretAnchor(PANEL, 'right')).toEqual({ x: 1440, y: 118 + 682 / 2 });
  });

  it('still prefers above and below for a control-sized target in the same column', () => {
    // The tour button and the tabs sit in the right column too. They must keep the old
    // vertical behaviour, or the whole top bar would start flipping sideways.
    expect(sideFor(box(60, 1040, 80, 30), VIEWPORT, 246)).toBe('below');
    expect(sideFor(box(840, 1040, 80, 30), VIEWPORT, 246)).toBe('above');
  });

  it('falls back to above when the viewport cannot fit the card beside the target', () => {
    const wide = { width: 700, height: 900 };
    expect(sideFor(box(0, 300, 400, 900), wide, 246)).toBe('above');
  });
});

describe('tour steps', () => {
  it('has twenty steps with unique ids', () => {
    expect(TOUR_STEPS).toHaveLength(20);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it('gives every step exactly one selector', () => {
    // A step with no target renders a card pointing at nothing on purpose, but a step with
    // an empty string is a typo, not a design decision.
    for (const s of TOUR_STEPS) {
      expect(typeof s.target, `${s.id} target is not a string`).toBe('string');
      expect(s.target.trim(), `${s.id} has an empty selector`).not.toBe('');
    }
  });

  it('never points two steps at the same control', () => {
    // Not the rule itself: the rule is one selector per step, which TourStep.target being a
    // bare string enforces. This catches a duplicate step arriving some other way.
    const seen = new Set<string>();
    for (const s of TOUR_STEPS) {
      expect(seen.has(s.target), `${s.id} repeats an earlier target: ${s.target}`).toBe(false);
      seen.add(s.target);
    }
  });

  it('explains each control in the transport row on its own', () => {
    // The three playback controls sit next to each other, so grouping them into one union
    // box was tempting and wrong: each does something different and each gets its own stop.
    for (const id of ['play', 'step-event', 'step-slot', 'speed', 'readout', 'lessons', 'share']) {
      expect(TOUR_STEPS.some((s) => s.id === id), `${id} has no step`).toBe(true);
    }
    expect(TOUR_STEPS.find((s) => s.id === 'lessons')!.target).toBe('[data-testid="lessons-open"]');
    expect(TOUR_STEPS.find((s) => s.id === 'share')!.target).toBe('[data-testid="share"]');
  });

  it('only uses data attributes as selectors, so a restyle cannot break a step', () => {
    for (const s of TOUR_STEPS) expect(s.target, `${s.id}: ${s.target}`).toMatch(/^\[data-(testid|tour)=".+"\]$/);
  });

  it('never targets a selector the app does not define', () => {
    // data-testid and data-tour are both greppable in src/, so a step cannot drift away
    // from an attribute that exists. This is the cheap half of the check; e2e/tour.spec.ts
    // walks every step against a live page and catches the rest.
    const defined = new Set(
      ['play', 'step-event', 'step-slot', 'speed', 'readout', 'share', 'lessons-open', 'scenario-select', 'node-picker', 'timeline']
        .map((t) => `[data-testid="${t}"]`)
        .concat([
          '[data-tour="mode"]',
          '[data-tour="seed"]',
          '[data-tour="canvas"]',
          '[data-tour="caption"]',
          '[data-tour="legend"]',
          // Written by Inspector.tsx as `panel-${active}`, one per tab.
          '[data-tour="panel-transaction"]',
          '[data-tour="panel-votor"]',
          '[data-tour="panel-tower"]',
          '[data-tour="panel-events"]',
          '[data-tour="panel-metrics"]',
        ]),
    );
    for (const s of TOUR_STEPS) expect(defined, `${s.id} targets an undefined selector: ${s.target}`).toContain(s.target);
  });

  it('walks the window in reading order, top left to bottom right', () => {
    // The array order *is* the tour order, so this is the only place the reading order can
    // be asserted. A geometric check is not available: the canvas target is the whole
    // .canvas-wrap that contains the caption and the legend, so those three boxes nest and
    // have no coordinate order to compare against. The sequence below is derived from the
    // layout in global.css (.app rows 52px / 1fr / 100px, .main columns 1fr / 400px, and a
    // flex .topbar whose DOM order is its visual order), and reordering it is a deliberate
    // act rather than something to do by accident while editing the copy.
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      // top bar, left to right
      'scenario', 'mode', 'seed', 'lessons', 'share', 'play', 'step-event', 'step-slot', 'speed', 'readout',
      // the canvas, then its caption above and its legend below
      'caption', 'canvas', 'legend',
      // the inspector column, top to bottom, and the panels in tab-strip order
      'node-picker', 'transaction', 'votor', 'tower', 'events', 'metrics',
      // the timeline, the bottom row of the whole window
      'timeline',
    ]);
  });

  it('names the component in the heading, and names a different one each time', () => {
    // The heading used to be the region ("Top bar"), so ten consecutive steps read TOP BAR
    // and the only thing telling two stops apart was the number. It must be the control.
    const seen = new Set<string>();
    for (const s of TOUR_STEPS) {
      expect(typeof s.label, `${s.id} has no label`).toBe('string');
      expect(s.label.trim().length, `${s.id} has an empty label`).toBeGreaterThan(0);
      expect(seen.has(s.label), `${s.id} repeats the heading "${s.label}"`).toBe(false);
      seen.add(s.label);
    }
  });

  it('does not use a region name as a heading', () => {
    // The specific failure: every control in the top bar shared one heading.
    for (const s of TOUR_STEPS) {
      for (const region of ['top bar', 'the panels', 'the network']) {
        expect(s.label.toLowerCase(), `${s.id} heads itself with the region`).not.toBe(region);
      }
    }
  });

  it('keeps every explanation to one readable paragraph', () => {
    for (const s of TOUR_STEPS) {
      expect(s.text.length, `${s.id} is very long`).toBeLessThan(360);
      expect(s.text.endsWith('.'), `${s.id} does not end in a full stop`).toBe(true);
    }
  });

  it('never tells the tour to change the app', () => {
    // The tour points and explains. Anything that mutates the run belongs in a lesson,
    // which already stops at the right moments with copy checked against the trace.
    //
    // "Never changes the app" is now narrower than it was: the tour may switch the
    // inspector tab to open the panel it is describing, and that is reverted on close. It
    // may still never touch the simulation itself, which is what this checks, and what
    // stops it from rebuilding the workers by switching protocol mode.
    for (const s of TOUR_STEPS) {
      expect(s.text, `${s.id} claims the tour acts`).not.toMatch(/\b(we (now|will) (press|click|switch|load)|this (starts|opens|changes) the run)\b/i);
    }
  });

  it('only opens tabs, and only on steps that need one', () => {
    for (const s of TOUR_STEPS) {
      if (s.tab !== undefined) expect(['transaction', 'votor', 'tower', 'events', 'metrics'], `${s.id} tab`).toContain(s.tab);
      // A step that switches the tab must target the panel, not the button that selects it,
      // or it would ring the tab and explain the content behind it, which is the bug that
      // made these three steps describe a panel that was never on screen.
      if (s.tab) expect(s.target, `${s.id} opens a tab but does not target the panel`).toContain('panel-');
    }
  });

  it('asks only for a protocol the inspector can actually show', () => {
    // `needs` is what makes a step skippable, so a step carrying an unknown protocol would
    // silently never appear in any mode.
    for (const s of TOUR_STEPS) {
      if (s.needs !== undefined) expect(['alpenglow', 'tower'], `${s.id} needs`).toContain(s.needs);
      if (s.needs) expect(s.tab, `${s.id} needs a protocol but opens no tab`).toBeDefined();
    }
  });
});

describe('visibleSteps', () => {
  const ids = (mode: Mode) => visibleSteps(mode).map((s) => s.id);

  it('shows every step in Compare, which runs both protocols', () => {
    expect(visibleSteps('compare')).toHaveLength(TOUR_STEPS.length);
  });

  it('drops the Tower panel step in Alpenglow-only mode', () => {
    // The Votor tab only exists when Alpenglow is running, and the Tower tab only when
    // TowerBFT is. Rather than showing an empty card the step is not shown at all.
    expect(ids('alpenglow')).not.toContain('tower');
    expect(ids('alpenglow')).toContain('votor');
    expect(visibleSteps('alpenglow')).toHaveLength(TOUR_STEPS.length - 1);
  });

  it('drops the Votor panel step in TowerBFT-only mode', () => {
    expect(ids('tower')).not.toContain('votor');
    expect(ids('tower')).toContain('tower');
    expect(visibleSteps('tower')).toHaveLength(TOUR_STEPS.length - 1);
  });

  it('never returns a step whose protocol is not running', () => {
    // The filter's whole job. If this holds for every mode, no step can reach the card in a
    // mode that cannot open its tab, which is the empty-card bug.
    for (const mode of ['alpenglow', 'tower', 'compare'] as Mode[]) {
      const protocols = protocolsFor(mode);
      for (const s of visibleSteps(mode)) {
        if (s.needs) expect(protocols, `${s.id} in ${mode} mode`).toContain(s.needs);
      }
    }
  });

  it('keeps the reading order after dropping a step', () => {
    const full = ids('compare');
    expect(ids('alpenglow').filter((id) => id !== 'tower')).toEqual(full.filter((id) => id !== 'tower'));
  });
});

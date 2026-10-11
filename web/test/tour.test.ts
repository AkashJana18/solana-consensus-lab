import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, NEEDS_BELOW, POPOVER_WIDTH, boxOf, caretAnchor, clamp, place, sideFor, unionBox, type Box } from '../src/tour/placement';
import { TOUR_STEPS } from '../src/tour/steps';

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

describe('tour steps', () => {
  it('has eighteen steps with unique ids', () => {
    expect(TOUR_STEPS).toHaveLength(18);
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
      ['play', 'step-event', 'step-slot', 'speed', 'readout', 'share', 'lessons-open', 'scenario-select', 'tx-stepper', 'node-picker', 'timeline', 'tab-votor', 'tab-tower']
        .map((t) => `[data-testid="${t}"]`)
        .concat(['[data-tour="mode"]', '[data-tour="seed"]', '[data-tour="canvas"]', '[data-tour="caption"]', '[data-tour="legend"]']),
    );
    for (const s of TOUR_STEPS) expect(defined, `${s.id} targets an undefined selector: ${s.target}`).toContain(s.target);
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
    for (const s of TOUR_STEPS) {
      expect(s.text, `${s.id} claims the tour acts`).not.toMatch(/\b(we (now|will) (press|click|switch|load)|this (starts|opens|changes) the run)\b/i);
    }
  });
});

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useStore, type Tab } from '../store/useStore';
import { adjacent, boxOf, caretAnchor, place, popoverWidth, unionBox, POPOVER_WIDTH, type Box, type Viewport } from '../tour/placement';
import { visibleSteps } from '../tour/steps';

/**
 * Height assumed for the card before it has measured itself, and the reason it is only that.
 *
 * `place` needs a height to centre a card beside a tall target and to decide above against
 * below, so the first guess has to exist. It was a hardcoded 246 forever, which quietly made
 * the tour's spacing wrong for every step whose copy was not four lines: the legend step's
 * card is about 129px tall, so "above" put its bottom edge 117px above the legend instead of
 * 14px, and the arrow on that edge pointed at the canvas rather than at the thing it was
 * describing. A card that reports its own height removes the class of bug.
 */
const CARD_H_FALLBACK = 246;

/**
 * A component tour: highlight one control, say what it does, move on.
 *
 * Four deliberate constraints, three of them learned from watching this get built wrong:
 *
 * - It never shows itself. One button opens it, and nothing else does, so it cannot break a
 *   test that is not about the tour and cannot block a returning visitor.
 * - It is not a modal. No backdrop, no focus trap, no `aria-modal`. There is no dim, so the
 *   highlighted component stays fully readable and clickable while it is ringed, which is
 *   the entire reason for ring-only rather than Zugzwang's cut-a-hole-in-the-dark.
 * - It never changes the simulation. No scenario, no seed, no protocol mode. Switching mode
 *   would rebuild both workers and restart the run at t=0 mid-tour, which is teaching by
 *   destroying the thing being described, and the lessons are where someone drives the
 *   simulation deliberately.
 * - It may open the inspector tab, and nothing else. The five panel steps describe content
 *   that is only mounted when its tab is active, so without this they ringed nothing and
 *   the card floated in the middle of the screen. The original tab is restored when the tour
 *   closes, so the app is left as it was found.
 *
 * The ring is Solana green on purpose: this is the one place in the UI where the project's
 * own identity should be visible, and it is not a data channel, so it does not collide with
 * the categorical palette on the canvas.
 */
export function ComponentTour() {
  const open = useStore((s) => s.tourOpen);
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const [index, setIndex] = useState(0);
  // The card's own height, measured by the card, because placement cannot be correct without
  // it. 246 is the height of the common case (eyebrow + four lines + buttons) and is only a
  // first guess: the copy varies, and the legend's step rendered 129px tall, which put the card
  // 117px off its target instead of GAP away while its caret pointed straight at the legend.
  // The correction lands in a layout effect, so it happens before the first paint.
  const [cardH, setCardH] = useState(CARD_H_FALLBACK);
  const reduced = useReducedMotion();
  const viewport = useViewport(open);

  // Steps whose panel cannot be opened in this mode are not in the list at all, so the
  // counter reflects what the reader is actually being shown. The mode never changes while
  // the tour is open, so `visible` is stable for the life of the tour.
  const visible = visibleSteps(mode);
  const step = visible[index];

  // One selector per step by construction (see steps.ts). querySelectorAll still runs,
  // because a single logical thing can appear once per protocol in Compare mode and those
  // are unioned into one ring rather than drawn twice.
  const box = useTargetBox(step?.target ?? '', open);

  // The tab to put back when the tour closes, captured on the way in rather than from the
  // closure of whichever handler happened to close it.
  const savedTab = useRef<Tab | null>(null);

  const close = useCallback(() => {
    set({ tourOpen: false });
    setIndex(0);
  }, [set]);

  /**
   * Move to a step, opening whatever panel it needs in the same commit.
   *
   * The tab has to be set here, in the event handler, rather than in an effect: an effect
   * runs after the render that changed `index`, so the measure effect would first look for
   * a panel the DOM does not have yet, find nothing, centre the card, and only correct on a
   * second pass. Setting both together means the panel is mounted in the render that also
   * carries the new step, and the ring lands on it the first time.
   */
  const goTo = useCallback(
    (i: number) => {
      const target = visible[i];
      if (!target) return;
      setIndex(i);
      if (target.tab) set({ tab: target.tab });
    },
    [set, visible],
  );

  const next = useCallback(() => {
    // Read the index from the closure rather than deciding inside a setIndex updater.
    // React calls an updater during render, so closing the tour from inside one is a
    // setState-during-render of a different component. Done on the last step closes,
    // because saturating at the final index would leave a button labelled Done that does
    // nothing.
    if (index >= visible.length - 1) {
      set({ tourOpen: false });
      setIndex(0);
      return;
    }
    goTo(index + 1);
  }, [index, visible.length, set, goTo]);
  const back = useCallback(() => goTo(Math.max(0, index - 1)), [goTo, index]);

  // Capture the tab on open and put it back on close, for every route out: the card's Skip
  // and Done, Escape, and the top bar's own toggle, which writes tourOpen directly and so
  // never passes through `close` above. Keyed on `open` rather than on the handlers, which
  // is the only way to catch that last one.
  useEffect(() => {
    if (open) {
      savedTab.current = useStore.getState().tab;
      return;
    }
    const was = savedTab.current;
    savedTab.current = null;
    if (was !== null && useStore.getState().tab !== was) useStore.getState().set({ tab: was });
  }, [open]);

  // Escape closes, arrows move. Registered in the capture phase on `document` so the keys
  // are handled before the window-level transport shortcuts in App.tsx, which would
  // otherwise scrub the clock while someone is paging through the tour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        back();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close, next, back]);

  if (!open || !step) return null;

  const isFirst = index === 0;
  const isLast = index === visible.length - 1;

  return (
    <>
      {/* The ring is a sibling of the app, not a wrapper around the target: a wrapper would
          either need a portal per target or would change the target's own layout, and the
          target has to keep rendering exactly as it does without the tour. */}
      {box && (
        <div className="tour-ring" aria-hidden style={{ top: box.top, left: box.left, width: box.width, height: box.height }} data-pulse={!reduced} />
      )}
      <TourCard
        label={step.label}
        text={step.text}
        index={index}
        count={visible.length}
        missing={box === null}
        anchor={box ? caretAnchor(box, place(box, viewport, cardH).side) : null}
        viewport={viewport}
        target={box}
        cardHeight={cardH}
        onHeight={setCardH}
        isFirst={isFirst}
        isLast={isLast}
        onBack={back}
        onNext={next}
        onSkip={close}
      />
      {/* Announced politely rather than trapped. The tour is not modal and focus stays on
          whichever button was last pressed, so nothing would otherwise tell assistive tech
          the step changed. aria-live lives on the card itself rather than a hidden mirror of
          its text, which would duplicate the copy in the DOM for no gain. */}
    </>
  );
}

/**
 * Resolve a step's selector to a rectangle, in viewport coordinates.
 *
 * Returns null when nothing matched or everything matched is zero-size, which is the
 * "nothing to point at" case: a collapsed legend or a filtered-out control reports 0x0 from
 * `display: none`. The card then centres itself and says so, rather than pointing at the
 * origin.
 *
 * This is now purely defensive. The two cases that used to reach it are gone: a panel the
 * current mode cannot show is skipped by `visibleSteps` rather than shown empty, and the
 * legend is only hidden below 1200px, which is narrower than the 1300px at which the tour
 * button disappears, so the legend is always visible while the tour can be opened. Kept
 * anyway, because a future breakpoint or a new step can reintroduce it, and a centred card
 * that says so is the right answer when it happens.
 */
function useTargetBox(selector: string, active: boolean): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  const measure = useCallback(() => {
    if (!active) return;
    // A malformed selector must not take the tour down; there is nothing to point at.
    let found: NodeListOf<Element>;
    try {
      found = document.querySelectorAll(selector);
    } catch {
      setBox(null);
      return;
    }
    const rects: Box[] = [];
    for (const el of found) rects.push(boxOf(el));
    setBox(unionBox(rects));
  }, [selector, active]);

  useEffect(() => {
    measure();
  }, [measure]);

  // Re-measure while open: a mode switch, a lesson opening, or the inspector resizing all
  // move the target, and a ring left at its old coordinates is worse than no ring at all.
  useEffect(() => {
    if (!active) return;
    window.addEventListener('resize', measure);
    const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    try {
      for (const el of document.querySelectorAll(selector)) obs?.observe(el);
    } catch {
      /* an unusable selector has nothing to observe */
    }
    return () => {
      window.removeEventListener('resize', measure);
      obs?.disconnect();
    };
  }, [selector, active, measure]);

  return box;
}

function useViewport(active: boolean): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    if (!active) return;
    const onResize = () => setVp({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);
  return vp;
}

function TourCard({
  label,
  text,
  index,
  count,
  missing,
  anchor,
  viewport,
  target,
  cardHeight,
  onHeight,
  isFirst,
  isLast,
  onBack,
  onNext,
  onSkip,
}: {
  label: string;
  text: string;
  index: number;
  count: number;
  missing: boolean;
  anchor: { x: number; y: number } | null;
  viewport: Viewport;
  target: Box | null;
  cardHeight: number;
  onHeight: (h: number) => void;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const at = target ? place(target, viewport, cardHeight) : null;
  const style = at
    ? { top: at.top, left: at.left }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  /**
   * Report the card's real height back up, so the placement above can be redone with it.
   *
   * A layout effect, not an effect, because the whole point is that the correction lands before
   * the browser paints: with a normal effect the reader would see the card placed against the
   * 246px guess for one frame, which is exactly the misalignment this removes.
   *
   * Half-pixel quantisation with an equality bail-out is what keeps this from oscillating.
   * Reporting the raw float would re-render whenever subpixel layout noise moved it, and
   * re-placing the card can change the text's own wrapping, which changes the height again.
   * A ResizeObserver keeps it honest when the copy reflows, e.g. the window narrows.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const h = Math.round(el.getBoundingClientRect().height * 2) / 2;
      if (h > 0) onHeight(h);
    };
    report();
    if (typeof ResizeObserver !== 'function') return;
    const obs = new ResizeObserver(report);
    obs.observe(el);
    return () => obs.disconnect();
  }, [onHeight]);

  // The caret points at the middle of the target's chosen edge, but only when the card is
  // actually beside it. `adjacent` is the real test: a card that `place` had to clamp into a
  // viewport corner is no longer GAP away from the target, so a caret on its edge would point
  // at whatever happens to be there. The second condition is a guard for the one case adjacency
  // cannot see: an anchor off the card's own extent, which would hang the diamond off a corner.
  const side = at?.side ?? 'center';
  const showCaret =
    at !== null && anchor !== null && target !== null && adjacent(target, viewport, cardHeight, at) &&
    (side === 'left' || side === 'right'
      ? anchor.y >= at.top && anchor.y <= at.top + cardHeight
      : Math.abs(anchor.x - (at.left + POPOVER_WIDTH / 2)) < 140);

  // Each side puts the caret's *centre* on the edge that faces the target, rotated so its two
  // borders meet at the point there. The CSS drops the two borders that would otherwise show
  // against the card's own fill, and it centres the rotated square with a translate applied
  // after the rotate, so these coordinates are read as the point rather than as a corner.
  // Computed only when there is a caret to place: `anchor` and `at` are both null for a step
  // whose target is missing, and a centred card has no edge to point from.
  //
  // The centre is what `translate(-50%, -50%)` leaves at the element's own top-left, so every
  // side is written as `left`/`top` and the two far edges are computed here rather than handed
  // to CSS as `right`/`bottom`. Those two do not compose: `bottom` measures from the
  // containing block's bottom while the translate still pulls the box up by half its height, so
  // the arrow ended up 9px off the card's bottom edge and 9px off its right one. Subtracting
  // the border is what lands it on the outline, because the containing block for an absolutely
  // positioned child is the ancestor's *padding* box, 1px inside the border the reader sees.
  const caret =
    showCaret && anchor !== null && at !== null
      ? side === 'below' ? { top: -1, left: anchor.x - at.left - 1 }
      : side === 'above' ? { top: cardHeight - 1, left: anchor.x - at.left - 1 }
      : side === 'left' ? { left: popoverWidth(viewport) - 1, top: anchor.y - at.top - 1 }
      : { left: -1, top: anchor.y - at.top - 1 }
      : null;

  return (
    <div className="tour-card" ref={ref} role="dialog" aria-label="Component tour" aria-live="polite" data-testid="tour-card" style={style} data-side={side}>
      {caret && <span className="tour-caret" aria-hidden style={caret} />}
      <div className="tour-head">
        <span className="tour-label">{label}</span>
        <span className="tour-count muted">
          {index + 1} / {count}
        </span>
      </div>
      <p className="tour-text">{text}</p>
      {missing && <p className="tour-missing muted">This part is not on screen at this width. Next still works.</p>}
      <div className="tour-actions">
        <button className="link" onClick={onSkip} data-testid="tour-skip">
          Skip
        </button>
        <div className="tour-nav">
          {!isFirst && (
            <button onClick={onBack} data-testid="tour-back">
              Back
            </button>
          )}
          <button className="primary" onClick={onNext} data-testid="tour-next">
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

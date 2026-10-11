import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useStore } from '../store/useStore';
import { boxOf, caretAnchor, place, unionBox, type Box, type Viewport } from '../tour/placement';
import { TOUR_STEPS } from '../tour/steps';

/**
 * A component tour: highlight one control, say what it does, move on.
 *
 * Three deliberate constraints, all of them learned from watching this get built wrong once:
 *
 * - It never shows itself. One button opens it, and nothing else does, so it cannot break a
 *   test that is not about the tour and cannot block a returning visitor.
 * - It is not a modal. No backdrop, no focus trap, no `aria-modal`. There is no dim, so the
 *   highlighted component stays fully readable and clickable while it is ringed, which is
 *   the entire reason for ring-only rather than Zugzwang's cut-a-hole-in-the-dark.
 * - It never changes the app. Next moves the highlight and nothing else. The tour describes;
 *   the lessons, which already stop at the right moments and check their copy against the
 *   trace, are where someone actually drives the simulation.
 *
 * The ring is Solana green on purpose: this is the one place in the UI where the project's
 * own identity should be visible, and it is not a data channel, so it does not collide with
 * the categorical palette on the canvas.
 */
export function ComponentTour() {
  const open = useStore((s) => s.tourOpen);
  const set = useStore((s) => s.set);
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const viewport = useViewport(open);

  const step = TOUR_STEPS[index];
  // One selector per step by construction (see steps.ts). querySelectorAll still runs,
  // because a single logical thing can appear once per protocol in Compare mode and those
  // are unioned into one ring rather than drawn twice.
  const box = useTargetBox(step.target, open);

  const close = useCallback(() => {
    set({ tourOpen: false });
    setIndex(0);
  }, [set]);

  const next = useCallback(() => {
    // Read the index from the closure rather than deciding inside a setIndex updater.
    // React calls an updater during render, so closing the tour from inside one is a
    // setState-during-render of a different component. Done on the last step closes,
    // because saturating at the final index would leave a button labelled Done that does
    // nothing.
    if (index >= TOUR_STEPS.length - 1) {
      set({ tourOpen: false });
      setIndex(0);
      return;
    }
    setIndex(index + 1);
  }, [index, set]);
  const back = useCallback(() => setIndex(Math.max(0, index - 1)), [index]);

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
  const isLast = index === TOUR_STEPS.length - 1;

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
        count={TOUR_STEPS.length}
        missing={box === null}
        anchor={box ? caretAnchor(box, place(box, viewport, 246).side) : null}
        viewport={viewport}
        target={box}
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
 * "nothing to point at" case: the legend is `display: none` below 1300px, and
 * Inspector.tsx filters tabs by protocol so the Votor tab is absent in Tower-only mode.
 * The card then centres itself and says so, rather than pointing at the origin.
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
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const CARD_H = 246;
  const at = target ? place(target, viewport, CARD_H) : null;
  const style = at
    ? { top: at.top, left: at.left }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  // The caret points at the middle of the target's chosen edge, but only when the card is
  // actually beside it; after clamping, a card pushed to a viewport corner has no meaningful
  // anchor and a caret would point at nothing.
  const showCaret = at !== null && anchor !== null && Math.abs(anchor.x - (at.left + 320 / 2)) < 140;

  return (
    <div className="tour-card" role="dialog" aria-label="Component tour" aria-live="polite" data-testid="tour-card" style={style} data-side={at?.side ?? 'center'}>
      {showCaret && <span className="tour-caret" aria-hidden style={at?.side === 'below' ? { top: -5, left: anchor!.x - at!.left } : { bottom: -5, left: anchor!.x - at!.left }} />}
      <div className="tour-head">
        <span className="tour-label">{label}</span>
        <span className="tour-count muted">
          {index + 1} / {count}
        </span>
      </div>
      <p className="tour-text">{text}</p>
      {missing && <p className="tour-missing muted">This part is not on screen at this width or in this mode. Next still works.</p>}
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

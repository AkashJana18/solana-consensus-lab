// Geometry for the component tour's popover. Pure functions over plain rectangles and a
// plain viewport, so the arithmetic is unit-testable in vitest's node environment (no DOM,
// no jsdom) the way render/interp.ts is.
//
// The model is deliberately simple: every step resolves to either one rectangle or a union
// of several (the transport row is three separate controls), and the popover goes above or
// below that union. There is no arrow-flipping, because there is no backdrop to escape
// from and no dimming: the page stays put and so does the target.

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type Side = 'above' | 'below' | 'left' | 'right';

/** Gap between the target ring and the popover. Matches the ring's own 6px halo. */
export const GAP = 14;

/** Breathing room kept between the popover and the viewport edge on every side. */
export const MARGIN = 16;

/** Width of the popover. 320 was chosen because every explanation fits without wrapping
 *  past four lines at this width, and narrower than ~300 starts truncating mid-sentence. */
export const POPOVER_WIDTH = 320;

/**
 * Height the popover needs below the target before below becomes the better side.
 *
 * 246 is the popover's real height in the common case (eyebrow + four lines of copy +
 * button row). Rather than measure it, reserve that much: if it does not fit, the popover
 * goes above instead, which is always available for anything except the very top of the
 * viewport. Too small a value and the popover overlaps the control it is describing;
 * too large and top-bar targets flip above the bar and cover the app header.
 */
export const NEEDS_BELOW = 246;

/** The smallest rectangle containing every input. Zero-size rects are dropped, because a
 *  hidden element (`display: none`, which is what a collapsed legend or a filtered-out tab
 *  gives us) reports width and height 0 and must not drag the union to the origin. */
export function unionBox(rects: readonly Box[]): Box | null {
  const visible = rects.filter((r) => r.width > 0 && r.height > 0);
  if (visible.length === 0) return null;
  const left = Math.min(...visible.map((r) => r.left));
  const top = Math.min(...visible.map((r) => r.top));
  const right = Math.max(...visible.map((r) => r.left + r.width));
  const bottom = Math.max(...visible.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Which side of the target has room for a popover of `popoverHeight`.
 *
 * Above and below first, exactly as before, so every control-sized target is unaffected. The
 * horizontal case exists for one thing: the inspector panel, which is 400px wide and fills
 * most of the viewport height. Neither above nor below fits it, and pinning the card to
 * whichever edge it could reach put it squarely on top of the panel it had just opened. A
 * target taller than the popover with room beside it now goes beside it instead, preferring
 * whichever side has more space.
 */
export function sideFor(target: Box, viewport: Viewport, popoverHeight: number): Side {
  const below = viewport.height - (target.top + target.height);
  const above = target.top;
  if (below >= popoverHeight) return 'below';
  if (above >= popoverHeight) return 'above';

  // Neither vertical side fits, so the target is tall. Beside it is the only way to avoid
  // covering the thing being described. The inspector sits hard against the right edge, so
  // in practice this always resolves to 'left' and lands over the canvas.
  const roomLeft = target.left - GAP - POPOVER_WIDTH;
  const roomRight = viewport.width - (target.left + target.width) - GAP - POPOVER_WIDTH;
  if (roomLeft >= MARGIN || roomRight >= MARGIN) return roomLeft >= roomRight ? 'left' : 'right';

  // A viewport too narrow for the popover beside the target either. Falling back to above
  // keeps the previous behaviour, which clamps the card into view rather than losing it.
  return 'above';
}

/** The width the popover is actually laid out at: the preferred width, narrowed rather than
 *  allowed to overflow a viewport that cannot hold it. Exported because a caller placing
 *  something against the popover's own edges needs the same number, not a second guess. */
export function popoverWidth(viewport: Viewport): number {
  return Math.min(POPOVER_WIDTH, Math.max(0, viewport.width - MARGIN * 2));
}

/**
 * Where the popover goes.
 *
 * Horizontal placement centres on the target and then clamps inside the viewport, so a
 * target at either edge pushes the card in rather than off screen. Vertical placement is
 * `sideFor`'s decision, then clamped as a backstop: a target near the top of a short
 * viewport can leave neither side with room, and a card pinned to the bottom edge is
 * better than one running off the top.
 */
export function place(target: Box, viewport: Viewport, popoverHeight: number): { top: number; left: number; side: Side } {
  const side = sideFor(target, viewport, popoverHeight);
  const width = popoverWidth(viewport);
  const maxLeft = viewport.width - MARGIN - width;
  const maxTop = Math.max(MARGIN, viewport.height - MARGIN - popoverHeight);
  const want = preferred(target, popoverHeight, side, width);
  return { top: clamp(want.top, MARGIN, maxTop), left: clamp(want.left, MARGIN, maxLeft), side };
}

/**
 * Where the card wants to go on `side`, before the viewport clamps it into view.
 *
 * Split out of `place` so `adjacent` can ask whether the clamp moved anything without
 * duplicating the arithmetic. Beside the target the card centres on the shared edge rather
 * than on the target itself, otherwise a wide target pushes the card off screen even when
 * there is room for it.
 */
function preferred(target: Box, popoverHeight: number, side: Side, width: number): { top: number; left: number } {
  if (side === 'left' || side === 'right') {
    return {
      top: target.top + target.height / 2 - popoverHeight / 2,
      left: side === 'left' ? target.left - GAP - width : target.left + target.width + GAP,
    };
  }
  return {
    left: target.left + target.width / 2 - width / 2,
    top: side === 'below' ? target.top + target.height + GAP : target.top - GAP - popoverHeight,
  };
}

/**
 * Is the card still exactly where it wanted to be, `GAP` from the target on `side`?
 *
 * This is the caret's licence to exist. `place` clamps as a backstop, and a clamped card is
 * no longer beside its target: the legend near the top of the canvas asked for 'above' with
 * no room above it, so the card was pinned to the viewport's top margin and ended up 117px
 * below the legend, and a caret on its edge pointed at empty canvas while appearing to point
 * at the legend. Measured against the ring, that arrow was off by more than its own width.
 *
 * Exact equality, not a tolerance: both numbers come from the same arithmetic, so a clamped
 * card differs by at least a pixel, and a subpixel threshold would only invite a placement
 * that is a hair off to keep a caret it cannot honour.
 */
export function adjacent(
  target: Box,
  viewport: Viewport,
  popoverHeight: number,
  at: { top: number; left: number; side: Side },
): boolean {
  const width = popoverWidth(viewport);
  const want = preferred(target, popoverHeight, at.side, width);
  return want.top === at.top && want.left === at.left;
}

/** Centre of the target's chosen edge, for the caret. */
export function caretAnchor(target: Box, side: Side): { x: number; y: number } {
  if (side === 'left') return { x: target.left, y: target.top + target.height / 2 };
  if (side === 'right') return { x: target.left + target.width, y: target.top + target.height / 2 };
  return {
    x: target.left + target.width / 2,
    y: side === 'below' ? target.top + target.height : target.top,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  // `hi` can be below `lo` when the viewport is narrower than the popover plus margins.
  // Returning `lo` keeps the card on screen rather than producing a NaN or a negative width.
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/** A rect straight out of getBoundingClientRect, with the fields this module needs. */
export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

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

export type Side = 'above' | 'below';

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

/** Which side of the target has room for a popover of `popoverHeight`. */
export function sideFor(target: Box, viewport: Viewport, popoverHeight: number): Side {
  const below = viewport.height - (target.top + target.height);
  return below >= popoverHeight ? 'below' : 'above';
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
  const width = Math.min(POPOVER_WIDTH, Math.max(0, viewport.width - MARGIN * 2));
  const left = clamp(target.left + target.width / 2 - width / 2, MARGIN, viewport.width - MARGIN - width);

  const preferred = side === 'below' ? target.top + target.height + GAP : target.top - GAP - popoverHeight;
  const maxTop = Math.max(MARGIN, viewport.height - MARGIN - popoverHeight);
  const top = clamp(preferred, MARGIN, maxTop);

  return { top, left, side };
}

/** Centre of the target's chosen edge, for the caret. */
export function caretAnchor(target: Box, side: Side): { x: number; y: number } {
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

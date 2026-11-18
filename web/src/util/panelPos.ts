// Geometry for the floating lesson pane. Pure functions over plain numbers, so the clamping is
// unit-testable in vitest's node environment (no DOM, no jsdom) the way tour/placement.ts is.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Breathing room kept between the pane and the viewport edge on every side. */
export const PANEL_MARGIN = 8;

/**
 * The pane's top-left, kept fully inside `viewport` with `margin` to spare.
 *
 * A remembered position outlives the window it was chosen in (a laptop today, a projector
 * tomorrow), and a pane that opens entirely off-screen cannot be recovered by dragging it.
 * Every read, drag step and resize therefore goes through here. When the pane is wider or
 * taller than the viewport, `margin` wins and the far edge is allowed to overflow; the
 * stylesheet caps the height separately.
 */
export function clampPanel(pos: Point, size: Size, viewport: Size, margin = PANEL_MARGIN): Point {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.min(Math.max(pos.x, margin), maxX),
    y: Math.min(Math.max(pos.y, margin), maxY),
  };
}

/** A stored position, or null for anything that is not a pair of finite numbers. */
export function parsePanelPos(raw: string | null): Point | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    // Corrupt entry, or storage disabled mid-read: both mean "no remembered position".
    return null;
  }
}

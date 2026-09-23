// Pure particle interpolation math (unit-tested; no Pixi imports).

export const FIZZLE_AT = 0.6;
export const ARC_BULGE = 0.12;

export interface Point {
  x: number;
  y: number;
}

/** Normalised progress of a message along its path at `now` (clamped to [0, 1]). */
export function progress(t: number, arriveAt: number, now: number): number {
  const dur = arriveAt - t;
  if (dur <= 0) return now >= arriveAt ? 1 : 0;
  return Math.min(1, Math.max(0, (now - t) / dur));
}

/**
 * Point along a slightly arced path from a to b. The arc is a quadratic bezier whose
 * control point is offset perpendicular to the chord by `bulge * chordLength`, always
 * to the left of travel so that a->b and b->a traffic don't overlap.
 */
export function pointOnPath(a: Point, b: Point, p: number, bulge = ARC_BULGE): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mx = (a.x + b.x) / 2 - dy * bulge;
  const my = (a.y + b.y) / 2 + dx * bulge;
  const q = 1 - p;
  return {
    x: q * q * a.x + 2 * q * p * mx + p * p * b.x,
    y: q * q * a.y + 2 * q * p * my + p * p * b.y,
  };
}

export interface ParticleState {
  /** Path progress in [0, 1]. */
  p: number;
  /** False once the particle should be recycled. */
  alive: boolean;
  /** 0..1 opacity multiplier (dropped particles fade out as they fizzle). */
  alpha: number;
}

export function particleState(t: number, arriveAt: number, dropped: boolean, now: number): ParticleState {
  if (now < t) return { p: 0, alive: true, alpha: 0 };
  const p = progress(t, arriveAt, now);
  if (dropped) {
    if (p >= FIZZLE_AT) return { p: FIZZLE_AT, alive: false, alpha: 0 };
    const fadeStart = FIZZLE_AT - 0.2;
    const alpha = p <= fadeStart ? 1 : 1 - (p - fadeStart) / (FIZZLE_AT - fadeStart);
    return { p, alive: true, alpha };
  }
  return { p, alive: now < arriveAt, alpha: 1 };
}

/** Whether a message is worth emitting at `now` given how far it is behind (used after a scrub). */
export function isVisibleAt(t: number, arriveAt: number, dropped: boolean, now: number): boolean {
  if (now < t) return false;
  const endAt = dropped ? t + (arriveAt - t) * FIZZLE_AT : arriveAt;
  return now < endAt;
}

import { describe, expect, it } from 'vitest';
import { FIZZLE_AT, isVisibleAt, particleState, pointOnPath, progress } from '../src/render/interp';

describe('progress', () => {
  it('is linear between send and arrival and clamps outside', () => {
    expect(progress(100, 200, 50)).toBe(0);
    expect(progress(100, 200, 100)).toBe(0);
    expect(progress(100, 200, 150)).toBeCloseTo(0.5);
    expect(progress(100, 200, 200)).toBe(1);
    expect(progress(100, 200, 999)).toBe(1);
  });
  it('handles zero-duration paths', () => {
    expect(progress(100, 100, 99)).toBe(0);
    expect(progress(100, 100, 100)).toBe(1);
  });
});

describe('pointOnPath', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  it('starts at a and ends at b', () => {
    expect(pointOnPath(a, b, 0)).toEqual({ x: 0, y: 0 });
    const end = pointOnPath(a, b, 1);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
  });
  it('bows off the chord at the midpoint by the bulge fraction', () => {
    const mid = pointOnPath(a, b, 0.5, 0.12);
    expect(mid.x).toBeCloseTo(50);
    // Quadratic bezier midpoint sits at half the control-point offset.
    expect(Math.abs(mid.y)).toBeCloseTo(100 * 0.12 * 0.5);
  });
  it('bows to opposite sides for opposite directions (no overlap)', () => {
    const ab = pointOnPath(a, b, 0.5);
    const ba = pointOnPath(b, a, 0.5);
    expect(Math.sign(ab.y)).toBe(-Math.sign(ba.y));
  });
  it('is a straight line with zero bulge', () => {
    expect(pointOnPath(a, b, 0.25, 0).x).toBeCloseTo(25);
    expect(pointOnPath(a, b, 0.25, 0).y).toBeCloseTo(0);
  });
});

describe('particleState', () => {
  it('delivered particles live until arrival with full alpha', () => {
    expect(particleState(0, 100, false, 50)).toEqual({ p: 0.5, alive: true, alpha: 1 });
    expect(particleState(0, 100, false, 100).alive).toBe(false);
  });
  it('dropped particles fizzle at 60% and fade in beforehand', () => {
    const early = particleState(0, 100, false, 30);
    expect(early.alpha).toBe(1);
    const fading = particleState(0, 100, true, 50);
    expect(fading.alive).toBe(true);
    expect(fading.alpha).toBeGreaterThan(0);
    expect(fading.alpha).toBeLessThan(1);
    const gone = particleState(0, 100, true, 60);
    expect(gone.alive).toBe(false);
    expect(gone.p).toBe(FIZZLE_AT);
  });
  it('is invisible before send time', () => {
    expect(particleState(100, 200, false, 50)).toEqual({ p: 0, alive: true, alpha: 0 });
  });
});

describe('isVisibleAt', () => {
  it('reports whether a message is still on the wire', () => {
    expect(isVisibleAt(0, 100, false, -1)).toBe(false);
    expect(isVisibleAt(0, 100, false, 0)).toBe(true);
    expect(isVisibleAt(0, 100, false, 99)).toBe(true);
    expect(isVisibleAt(0, 100, false, 100)).toBe(false);
    expect(isVisibleAt(0, 100, true, 59)).toBe(true);
    expect(isVisibleAt(0, 100, true, 60)).toBe(false);
  });
});

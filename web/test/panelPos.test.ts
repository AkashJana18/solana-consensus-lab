import { describe, expect, it } from 'vitest';
import { clampPanel, parsePanelPos } from '../src/util/panelPos';

const viewport = { width: 1440, height: 900 };
const pane = { width: 360, height: 480 };

describe('clampPanel', () => {
  it('leaves a position that already fits alone', () => {
    expect(clampPanel({ x: 200, y: 150 }, pane, viewport)).toEqual({ x: 200, y: 150 });
  });

  it('pulls a pane back inside the right and bottom edges with a margin', () => {
    expect(clampPanel({ x: 2000, y: 2000 }, pane, viewport)).toEqual({ x: 1440 - 360 - 8, y: 900 - 480 - 8 });
  });

  it('pulls a pane in from above and to the left', () => {
    expect(clampPanel({ x: -80, y: -20 }, pane, viewport)).toEqual({ x: 8, y: 8 });
  });

  it('honours a custom margin', () => {
    expect(clampPanel({ x: 0, y: 0 }, pane, viewport, 20)).toEqual({ x: 20, y: 20 });
  });

  it('keeps the top-left visible when the viewport is smaller than the pane', () => {
    expect(clampPanel({ x: 500, y: 500 }, { width: 900, height: 900 }, { width: 390, height: 844 })).toEqual({ x: 8, y: 8 });
  });

  it('does not produce a NaN or a negative offset for a zero-sized viewport', () => {
    expect(clampPanel({ x: 4, y: 4 }, pane, { width: 0, height: 0 })).toEqual({ x: 8, y: 8 });
  });
});

describe('parsePanelPos', () => {
  it('reads a stored pair', () => {
    expect(parsePanelPos('{"x":120,"y":90.5}')).toEqual({ x: 120, y: 90.5 });
  });

  it('rejects an absent, empty or malformed entry', () => {
    expect(parsePanelPos(null)).toBeNull();
    expect(parsePanelPos('')).toBeNull();
    expect(parsePanelPos('{')).toBeNull();
    expect(parsePanelPos('null')).toBeNull();
    expect(parsePanelPos('[]')).toBeNull();
    expect(parsePanelPos('"nope"')).toBeNull();
  });

  it('rejects pairs that are not finite numbers', () => {
    expect(parsePanelPos('{"x":"12","y":90}')).toBeNull();
    expect(parsePanelPos('{"x":12}')).toBeNull();
    expect(parsePanelPos('{"x":12,"y":null}')).toBeNull();
    // JSON.parse turns 1e999 into Infinity, and a pane at Infinity is not placeable.
    expect(parsePanelPos('{"x":1e999,"y":90}')).toBeNull();
  });
});

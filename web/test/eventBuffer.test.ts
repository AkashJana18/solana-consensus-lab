import { describe, expect, it } from 'vitest';
import { EventBuffer } from '../src/engine/eventBuffer';
import type { Traced } from '../src/engine/types';

const log = (t: number, msg = ''): Traced => ({ t, type: 'log', msg: msg || `t${t}` });

describe('EventBuffer', () => {
  it('appends sorted batches and indexes by time', () => {
    const b = new EventBuffer();
    b.append([log(0), log(10), log(10), log(25)]);
    b.append([log(30), log(40)]);
    expect(b.length).toBe(6);
    expect(b.lastTime).toBe(40);
    expect(b.indexAfter(-1)).toBe(0);
    expect(b.indexAfter(10)).toBe(3);
    expect(b.indexAfter(26)).toBe(4);
    expect(b.indexAfter(1000)).toBe(6);
  });

  it('range is exclusive of from and inclusive of to', () => {
    const b = new EventBuffer();
    b.append([log(0), log(10), log(20), log(30)]);
    expect(b.range(0, 20).map((e) => e.t)).toEqual([10, 20]);
    expect(b.range(35, 100)).toEqual([]);
    expect(b.range(20, 10)).toEqual([]);
  });

  it('drain consumes monotonically and never re-delivers', () => {
    const b = new EventBuffer();
    b.append([log(5), log(15), log(25)]);
    expect(b.drain(4)).toEqual([]);
    expect(b.drain(15).map((e) => e.t)).toEqual([5, 15]);
    expect(b.drain(15)).toEqual([]);
    b.append([log(35)]);
    expect(b.drain(100).map((e) => e.t)).toEqual([25, 35]);
    expect(b.consumed).toBe(4);
  });

  it('seek repositions the cursor', () => {
    const b = new EventBuffer();
    b.append([log(1), log(2), log(3)]);
    b.drain(3);
    b.seek(1);
    expect(b.drain(3).map((e) => e.t)).toEqual([2, 3]);
  });

  it('repairs an out-of-order batch instead of corrupting the index', () => {
    const b = new EventBuffer();
    b.append([log(10), log(20)]);
    b.append([log(5), log(30)]);
    expect(b.range(-1, 100).map((e) => e.t)).toEqual([5, 10, 20, 30]);
  });

  it('clear resets everything', () => {
    const b = new EventBuffer();
    b.append([log(1)]);
    b.drain(1);
    b.clear();
    expect(b.length).toBe(0);
    expect(b.consumed).toBe(0);
    expect(b.lastTime).toBe(-1);
  });
});

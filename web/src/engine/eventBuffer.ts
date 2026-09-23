import type { Traced } from './types';

/**
 * Append-only, time-indexed buffer of trace events with a consumption cursor.
 * Events arrive from the worker already sorted by `t` (the engine is a discrete
 * event simulator), so appends are O(1) and time lookups are binary searches.
 */
export class EventBuffer {
  private events: Traced[] = [];
  private cursor = 0;

  get length(): number {
    return this.events.length;
  }

  /** Sim time of the latest buffered event, or -1 when empty. */
  get lastTime(): number {
    return this.events.length ? this.events[this.events.length - 1].t : -1;
  }

  append(batch: Traced[]): void {
    if (batch.length === 0) return;
    // Defensive: keep the invariant even if a batch arrives slightly out of order.
    const last = this.lastTime;
    if (batch[0].t < last || !isSorted(batch)) {
      this.events = this.events.concat(batch).sort((a, b) => a.t - b.t);
      return;
    }
    for (const e of batch) this.events.push(e);
  }

  clear(): void {
    this.events = [];
    this.cursor = 0;
  }

  /** Index of the first event with t > time. */
  indexAfter(time: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid].t <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Events with from < t <= to (inclusive of `to`), independent of the cursor. */
  range(from: number, to: number): Traced[] {
    if (to < from) return [];
    return this.events.slice(this.indexAfter(from), this.indexAfter(to));
  }

  /** Move the cursor so the next drain starts just after `time`. */
  seek(time: number): void {
    this.cursor = this.indexAfter(time);
  }

  /** Consume every not-yet-consumed event with t <= time. */
  drain(time: number): Traced[] {
    const end = this.indexAfter(time);
    if (end <= this.cursor) return [];
    const out = this.events.slice(this.cursor, end);
    this.cursor = end;
    return out;
  }

  get consumed(): number {
    return this.cursor;
  }
}

function isSorted(batch: Traced[]): boolean {
  for (let i = 1; i < batch.length; i++) if (batch[i].t < batch[i - 1].t) return false;
  return true;
}

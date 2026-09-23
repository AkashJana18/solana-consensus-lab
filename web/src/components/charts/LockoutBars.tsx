import type { Lockout } from '../../engine/types';

export const MAX_LOCKOUT_HISTORY = 31;
export const THRESHOLD_DEPTH = 8;

/**
 * Tower lockouts as horizontal bars. Bar length is confirmation_count, i.e. log2 of the
 * lockout (2^confirmation_count slots) — a log scale, so the 2^31 root fits beside 2^1.
 * The most recent vote is the top row; the depth-8 threshold check row is marked.
 */
export function LockoutBars({ lockouts, root, currentSlot }: { lockouts: Lockout[]; root: number | null; currentSlot: number }) {
  const rows = [...lockouts].sort((a, b) => b.slot - a.slot);
  return (
    <div className="lockouts">
      <div className="lockout-scale muted">
        <span>lockout 2^1</span>
        <span>2^16</span>
        <span>2^31</span>
      </div>
      {rows.map((l, i) => {
        const w = (Math.min(MAX_LOCKOUT_HISTORY, l.confirmation_count) / MAX_LOCKOUT_HISTORY) * 100;
        const lockedThrough = l.slot + 2 ** Math.min(63, l.confirmation_count);
        const active = lockedThrough >= currentSlot;
        return (
          <div key={l.slot} className={`lockout-row ${i === THRESHOLD_DEPTH ? 'threshold' : ''}`} title={`slot ${l.slot}: confirmation_count ${l.confirmation_count}, locked out through slot ${lockedThrough}`}>
            <span className="lockout-slot">{l.slot}</span>
            <div className="lockout-track">
              <div className={`lockout-bar ${active ? '' : 'expired'}`} style={{ width: `${Math.max(2, w)}%` }} />
            </div>
            <span className="lockout-count">
              2<sup>{l.confirmation_count}</sup>
            </span>
            {i === THRESHOLD_DEPTH && <span className="lockout-marker">depth 8 · needs ≥⅔ stake</span>}
          </div>
        );
      })}
      <div className="lockout-root">
        <span className="root-dot" /> root {root ?? '—'}
        <span className="muted"> · a vote at depth 32 (2^31 lockout) becomes the root</span>
      </div>
    </div>
  );
}

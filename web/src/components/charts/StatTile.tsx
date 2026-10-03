import type { ReactNode } from 'react';

/** `tone` colours the value; without one the tile uses the default ink. */
export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={tone === undefined ? 'tile' : `tile tone-${tone}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}

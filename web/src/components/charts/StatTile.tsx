import type { ReactNode } from 'react';

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'warn' | 'neutral' }) {
  return (
    <div className={`tile tone-${tone ?? 'neutral'}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}

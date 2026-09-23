export interface Segment {
  value: number;
  color: string;
  label: string;
  hatched?: boolean;
}

export interface Threshold {
  pct: number;
  label: string;
}

/**
 * Horizontal stacked stake-tally bar (0-100 %) with vertical threshold lines.
 * Segments carry identity by label + colour; adjacent fills keep a 2px surface gap.
 */
export function TallyBar({ title, segments, thresholds, height = 14 }: { title: string; segments: Segment[]; thresholds: Threshold[]; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  return (
    <div className="tally" title={segments.map((s) => `${s.label}: ${s.value.toFixed(1)}%`).join(' · ')}>
      <div className="tally-head">
        <span>{title}</span>
        <span className="tally-total">{total.toFixed(1)}%</span>
      </div>
      <svg width="100%" height={height + 12} viewBox={`0 0 100 ${height + 12}`} preserveAspectRatio="none" className="tally-svg">
        <rect x={0} y={0} width={100} height={height} rx={2} className="tally-track" />
        {segments.map((s, i) => {
          const x = acc;
          acc += s.value;
          if (s.value <= 0) return null;
          return <rect key={i} x={x + (i > 0 ? 0.4 : 0)} y={0} width={Math.max(0, Math.min(100 - x, s.value) - (i > 0 ? 0.4 : 0))} height={height} fill={s.color} opacity={s.hatched ? 0.55 : 1} />;
        })}
        {thresholds.map((t) => (
          <g key={t.pct}>
            <line x1={t.pct} x2={t.pct} y1={-1} y2={height + 1} className="tally-threshold" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      <div className="tally-thresholds">
        {thresholds.map((t) => (
          <span key={t.pct} style={{ left: `${t.pct}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

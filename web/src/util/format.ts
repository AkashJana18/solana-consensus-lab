/** Sim microseconds -> "1,234.5 ms". */
export function fmtMs(us: number | null | undefined, digits = 1): string {
  if (us === null || us === undefined || !Number.isFinite(us)) return '—';
  return (us / 1000).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' ms';
}

/** Milliseconds (already ms, e.g. metrics.tx_stage_ms) -> "1,234.5 ms". */
export function fmtMsValue(ms: number | null | undefined, digits = 1): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return ms.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' ms';
}

export function fmtDeltaMs(us: number | null): string {
  if (us === null) return '—';
  return (us >= 0 ? '+' : '') + (us / 1000).toFixed(1) + ' ms';
}

export function slotOf(us: number, slotMs: number): number {
  return Math.floor(us / (slotMs * 1000));
}

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString();
}

export function pct(x: number): string {
  return `${x.toFixed(x >= 10 ? 0 : 1)}%`;
}

export const PROTOCOL_LABEL = { alpenglow: 'Alpenglow', tower: 'TowerBFT' } as const;

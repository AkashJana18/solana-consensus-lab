import type { Metrics, Protocol } from '../../engine/types';
import { protocolsFor, useStore } from '../../store/useStore';
import { PROTOCOL_LABEL, fmtBytes, fmtInt, fmtMsValue } from '../../util/format';
import { StatTile } from '../charts/StatTile';

export function MetricsPanel() {
  const mode = useStore((s) => s.mode);
  const runs = useStore((s) => s.runs);
  const protocols = protocolsFor(mode);
  const m: Partial<Record<Protocol, Metrics | null>> = {};
  for (const p of protocols) m[p] = runs[p]?.metrics ?? null;
  const single = protocols.length === 1 ? m[protocols[0]] : null;

  return (
    <div className="metrics-panel">
      <p className="muted small">Accumulated over every trace event the engine has produced so far (the worker runs ≤ 300 ms ahead of the display clock).</p>
      {protocols.length === 1 && (
        <div className="tiles">
          <StatTile label="Time to confirmed" value={fmtMsValue(single?.tx_stage_ms.confirmed)} hint="hero tx, from t = 0" tone="warn" />
          <StatTile label="Time to finalized" value={fmtMsValue(single?.tx_stage_ms.finalized)} hint="hero tx, from t = 0" tone="good" />
          <StatTile label="Messages" value={fmtInt(single?.total_msgs)} hint={`${fmtBytes(single?.total_bytes)} total`} />
          <StatTile label="Blocks / slots" value={`${fmtInt(single?.blocks_produced)} / ${fmtInt(single?.slots_started)}`} hint="produced / started" />
        </div>
      )}
      <table className="kv metrics-table" data-testid="metrics-table">
        <thead>
          <tr>
            <th>metric</th>
            {protocols.map((p) => (
              <th key={p} className={`proto-${p}`}>
                {PROTOCOL_LABEL[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="time to confirmed" protocols={protocols} f={(x) => fmtMsValue(x.tx_stage_ms.confirmed)} m={m} />
          <Row label="time to finalized" protocols={protocols} f={(x) => fmtMsValue(x.tx_stage_ms.finalized)} m={m} />
          <Row label="messages" protocols={protocols} f={(x) => fmtInt(x.total_msgs)} m={m} />
          <Row label="bytes" protocols={protocols} f={(x) => fmtBytes(x.total_bytes)} m={m} />
          <Row label="blocks produced" protocols={protocols} f={(x) => fmtInt(x.blocks_produced)} m={m} />
          <Row label="slots started" protocols={protocols} f={(x) => fmtInt(x.slots_started)} m={m} />
          <Section label="votes by kind" />
          {keys(protocols, m, (x) => x.votes).map((k) => (
            <Row key={k} label={k.replace(/_/g, ' ')} protocols={protocols} f={(x) => fmtInt(x.votes[k as keyof Metrics['votes']] ?? 0)} m={m} indent />
          ))}
          <Section label="certificates by kind" />
          {keys(protocols, m, (x) => x.certificates).map((k) => (
            <Row key={k} label={k.replace(/_/g, ' ')} protocols={protocols} f={(x) => fmtInt(x.certificates[k as keyof Metrics['certificates']] ?? 0)} m={m} indent />
          ))}
          <Section label="messages by kind (count · dropped)" />
          {keys(protocols, m, (x) => x.msgs).map((k) => (
            <Row key={k} label={k} protocols={protocols} f={(x) => (x.msgs[k] ? `${fmtInt(x.msgs[k].count)}${x.msgs[k].dropped ? ` · ${fmtInt(x.msgs[k].dropped)} dropped` : ''}` : '—')} m={m} indent />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function keys(protocols: Protocol[], m: Partial<Record<Protocol, Metrics | null>>, pick: (x: Metrics) => Record<string, unknown>): string[] {
  const set = new Set<string>();
  for (const p of protocols) {
    const x = m[p];
    if (x) for (const k of Object.keys(pick(x))) set.add(k);
  }
  return [...set].sort();
}

function Row({ label, protocols, f, m, indent }: { label: string; protocols: Protocol[]; f: (x: Metrics) => string; m: Partial<Record<Protocol, Metrics | null>>; indent?: boolean }) {
  return (
    <tr>
      <td className={indent ? 'indent' : ''}>{label}</td>
      {protocols.map((p) => (
        <td key={p} className="num">
          {m[p] ? f(m[p]!) : '—'}
        </td>
      ))}
    </tr>
  );
}

function Section({ label }: { label: string }) {
  return (
    <tr className="section">
      <td colSpan={3}>{label}</td>
    </tr>
  );
}

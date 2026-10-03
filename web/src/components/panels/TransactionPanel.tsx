import type { Protocol } from '../../engine/types';
import { STAGE_HINT, STAGE_LABEL, TX_STAGES, stageDelta, type TxStageMap } from '../../engine/txStages';
import { protocolsFor, useStore } from '../../store/useStore';
import { PROTOCOL_LABEL, fmtDeltaMs, fmtMs } from '../../util/format';

/** Vertical stepper of the eight hero-tx stages, one time column per protocol. */
export function TransactionPanel() {


  const mode = useStore((s) => s.mode);
  // reduceTxStages returns the same object until a stage is actually reached, so this
  // panel stops re-rendering on the 15 Hz clock flush instead of riding it.
  const alpenglowStages = useStore((s) => s.runs.alpenglow?.txStages);
  const towerStages = useStore((s) => s.runs.tower?.txStages);
  const protocols = protocolsFor(mode);
  const maps: Record<string, TxStageMap> = {};
  for (const p of protocols) maps[p] = (p === 'tower' ? towerStages : alpenglowStages) ?? {};

  return (
    <div className="tx-panel">
      <p className="muted small">
        First time each stage is reached by <em>any</em> node (first occurrence wins). Hover a stage for what it means.
      </p>
      <table className="stepper" data-testid="tx-stepper">
        <thead>
          <tr>
            <th />
            <th>Stage</th>
            {protocols.map((p) => (
              <th key={p} className={`proto-${p}`}>
                {PROTOCOL_LABEL[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TX_STAGES.map((st, i) => {
            const reached = protocols.some((p) => maps[p][st]);
            return (
              <tr key={st} className={reached ? 'reached' : ''} title={STAGE_HINT[st]}>
                <td className="step-dot-cell">
                  <span className={`step-dot ${st}`} />
                  {i < TX_STAGES.length - 1 && <span className="step-line" />}
                </td>
                <td className="step-label">
                  {STAGE_LABEL[st]}
                  <div className="step-hint">{STAGE_HINT[st]}</div>
                </td>
                {protocols.map((p) => (
                  <td key={p} className="step-time" data-testid={`stage-${p}-${st}`} data-reached={maps[p][st] ? 'true' : 'false'}>
                    {fmtMs(maps[p][st]?.t)}
                    {maps[p][st]?.slot !== undefined && <span className="muted"> · s{maps[p][st]?.slot}</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Latency</h3>
      <table className="kv">
        <thead>
          <tr>
            <th>from inclusion to…</th>
            {protocols.map((p) => (
              <th key={p}>{PROTOCOL_LABEL[p]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <DeltaRow label="confirmed" protocols={protocols} maps={maps} to="confirmed" />
          <DeltaRow label="finalized" protocols={protocols} maps={maps} to="finalized" />
        </tbody>
      </table>
    </div>
  );
}

function DeltaRow({ label, protocols, maps, to }: { label: string; protocols: Protocol[]; maps: Record<string, TxStageMap>; to: 'confirmed' | 'finalized' }) {
  return (
    <tr>
      <td>{label}</td>
      {protocols.map((p) => (
        <td key={p} className="num">
          {fmtDeltaMs(stageDelta(maps[p], 'included_in_block', to))}
        </td>
      ))}
    </tr>
  );
}

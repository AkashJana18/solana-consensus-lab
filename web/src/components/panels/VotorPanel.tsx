import type { AlpenglowInspect, PoolTally } from '../../engine/types';
import { shortHash } from '../../store/runView';
import { useStore } from '../../store/useStore';
import { TallyBar } from '../charts/TallyBar';

const FLAGS: { key: keyof Omit<AlpenglowInspect['votor'][number], 'slot' | 'parents_ready' | 'pending'>; label: string }[] = [
  { key: 'voted', label: 'Voted' },
  { key: 'voted_notar', label: 'VotedNotar' },
  { key: 'bad_window', label: 'BadWin' },
  { key: 'its_over', label: 'ItsOver' },
  { key: 'block_notarized', label: 'BlkNotar' },
];
const FLAG_TITLE: Record<string, string> = {
  Voted: 'Voted: cast any vote for this slot',
  VotedNotar: 'VotedNotar: cast a Notarize vote',
  BadWin: 'BadWindow: leader window flagged bad (skip the rest of it)',
  ItsOver: "ItsOver: slot settled locally, no more votes",
  BlkNotar: 'BlockNotarized: saw a notarization certificate',
};

const THRESHOLDS = [
  { pct: 20, label: '20' },
  { pct: 40, label: '40' },
  { pct: 60, label: '60' },
  { pct: 80, label: '80' },
];

export function VotorPanel() {
  const run = useStore((s) => s.runs.alpenglow);
  const selected = useStore((s) => s.selectedNode);
  const insp = run?.inspect;
  if (!run?.meta) return <p className="empty">Loading…</p>;
  if (!insp || insp.protocol !== 'alpenglow') {
    return <p className="empty">Select a validator on the canvas to inspect its Votor state and vote Pool.</p>;
  }
  const pools = insp.pool.filter((p): p is PoolTally => p !== null).sort((a, b) => b.slot - a.slot);
  return (
    <div className="votor-panel">
      <div className="row-between">
        <h3>
          Node {selected} · Votor flags
        </h3>
        <span className="muted small">
          finalized up to slot {insp.highest_finalized_slot} · hero block {shortHash(insp.hero_block)}
        </span>
      </div>
      {insp.votor.length === 0 ? (
        <p className="empty">No Votor state yet.</p>
      ) : (
        <table className="flags">
          <thead>
            <tr>
              <th>slot</th>
              {FLAGS.map((f) => (
                <th key={f.key} title={FLAG_TITLE[f.label]}>
                  {f.label}
                </th>
              ))}
              <th title="ParentReady: a notarized/skipped parent chain is ready to build on">ParentRdy</th>
            </tr>
          </thead>
          <tbody>
            {[...insp.votor].reverse().map((r) => (
              <tr key={r.slot}>
                <td className="num">{r.slot}</td>
                {FLAGS.map((f) => (
                  <td key={f.key} className={`flag ${r[f.key] ? 'on' : ''} ${f.key === 'bad_window' && r[f.key] ? 'bad' : ''}`}>
                    {r[f.key] ? '●' : '·'}
                  </td>
                ))}
                <td className={`flag ${r.parents_ready.length ? 'on' : ''}`} title={r.parents_ready.map((h) => shortHash(h)).join(', ')}>
                  {r.parents_ready.length ? '●' : '·'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Pool tallies (stake %)</h3>
      <p className="muted small">
        Notarize / notar-fallback and skip / skip-fallback are stacked (fallback lighter). Dashed lines: <b>20 %</b> safe-to-skip · <b>40 %</b> safe-to-notar · <b>60 %</b> notarize, skip
        &amp; finalize certs · <b>80 %</b> fast-finalization.
      </p>
      {pools.length === 0 && <p className="empty">No votes pooled yet.</p>}
      {pools.map((p) => {
        const notar = p.notarize.reduce((a, x) => a + x.pct, 0);
        const notarFb = p.notar_fallback.reduce((a, x) => a + x.pct, 0);
        const top = [...p.notarize].sort((a, b) => b.pct - a.pct)[0];
        return (
          <div key={p.slot} className="pool-slot">
            <div className="pool-head">
              <b>slot {p.slot}</b>
              <span className="muted small">
                {top ? `block ${shortHash(top.hash)}` : 'no block'}
                {p.notarize.length > 1 ? ` (+${p.notarize.length - 1} competing)` : ''}
              </span>
              <span className="certs">
                {p.certs.map((c, i) => (
                  <span key={i} className={`chip cert-${c.kind}`}>
                    {c.kind.replace(/_/g, ' ')}
                  </span>
                ))}
              </span>
            </div>
            <TallyBar
              title="notarize"
              thresholds={THRESHOLDS}
              segments={[
                { value: notar, color: 'var(--c-vote)', label: 'notarize' },
                { value: notarFb, color: 'var(--c-vote)', label: 'notar-fallback', hatched: true },
              ]}
            />
            <TallyBar
              title="skip"
              thresholds={THRESHOLDS}
              segments={[
                { value: p.skip_pct, color: 'var(--c-skip)', label: 'skip' },
                { value: p.skip_fallback_pct, color: 'var(--c-skip)', label: 'skip-fallback', hatched: true },
              ]}
            />
            <TallyBar title="finalize" thresholds={THRESHOLDS} segments={[{ value: p.finalize_pct, color: 'var(--c-finalize)', label: 'finalize' }]} />
          </div>
        );
      })}
    </div>
  );
}

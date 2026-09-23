import { useStore } from '../../store/useStore';
import { ForkTree, forkNodesFromBlocks, type ForkTreeNode } from '../charts/ForkTree';
import { LockoutBars } from '../charts/LockoutBars';
import { shortHash } from '../../store/runView';

/**
 * TowerBFT view for the selected node. Lockouts come from the latest `tower_update`
 * trace event (display-time accurate) with `inspect()` as a fallback; the fork tree
 * is built from `block_produced` + `fork_choice` events, enriched by `inspect().forks`.
 */
export function TowerPanel() {
  const run = useStore((s) => s.runs.tower);
  const selected = useStore((s) => s.selectedNode) ?? 0;
  if (!run?.meta) return <p className="empty">Loading…</p>;
  const insp = run.inspect && run.inspect.protocol === 'tower' ? run.inspect : null;
  const tower = run.towers.get(selected) ?? (insp && insp.node === selected ? { lockouts: insp.lockouts, root: insp.root, t: 0 } : null);
  const head = run.heads.get(selected) ?? insp?.head ?? null;
  const nodes: ForkTreeNode[] = forkNodesFromBlocks(run.blocks, run.heads, run.heroHash);
  if (insp?.forks) {
    const byHash = new Map(insp.forks.map((f) => [f.hash, f]));
    for (const n of nodes) {
      const f = byHash.get(n.hash);
      if (f) Object.assign(n, { weightPct: f.weight_pct, confirmed: f.confirmed, rooted: f.rooted });
    }
  }
  const noData = !tower && run.blocks.length === 0;
  return (
    <div className="tower-panel">
      <div className="row-between">
        <h3>Node {selected} · lockout tower</h3>
        <span className="muted small">
          head {head ? `slot ${head.slot} · ${shortHash(head.hash)}` : '—'}
          {insp && ` · depth-8 threshold ${insp.threshold_ok ? 'met' : 'not met'}`}
        </span>
      </div>
      {noData && (
        <p className="empty" data-testid="tower-empty">
          No TowerBFT data yet. Bars appear as <code>tower_update</code> events arrive; the fork tree fills from <code>block_produced</code> and <code>fork_choice</code>.
        </p>
      )}
      {tower ? (
        tower.lockouts.length ? (
          <LockoutBars lockouts={tower.lockouts} root={tower.root} currentSlot={run.currentSlot} />
        ) : (
          <p className="empty">Tower is empty (no votes yet).</p>
        )
      ) : (
        !noData && <p className="empty">This node has not voted yet.</p>
      )}
      <div className="row-between">
        <h3>Fork tree</h3>
        <span className="muted small">
          confirmed ≤ slot {run.commitment.confirmed < 0 ? '—' : run.commitment.confirmed} · finalized ≤ slot {run.commitment.finalized < 0 ? '—' : run.commitment.finalized}
        </span>
      </div>
      <ForkTree nodes={nodes} />
      <p className="muted small">Numbers inside a block = how many validators currently pick it as heaviest fork head. Hero block outlined.</p>
    </div>
  );
}

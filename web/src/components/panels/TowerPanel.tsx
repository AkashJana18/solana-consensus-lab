import { useStore } from '../../store/useStore';
import { ForkTree, forkNodesFromBlocks, type ForkTreeNode } from '../charts/ForkTree';
import { LockoutBars } from '../charts/LockoutBars';
import { shortHash } from '../../store/runView';

/**
 * TowerBFT view for the selected node. Lockouts come from the latest `tower_update`
 * trace event (display-time accurate) with `inspect()` as a fallback; the fork tree
 * is built from `block_produced` + `fork_choice` events, enriched by `inspect().forks`.
 */
const EMPTY_COMMITMENT = { processed: -1, confirmed: -1, finalized: -1 };

export function TowerPanel() {

  // Field-by-field rather than the whole view: each of these keeps its identity until its
  // own trace event arrives, so the panel no longer re-renders on every 15 Hz flush.
  const meta = useStore((s) => s.runs.tower?.meta ?? null);
  const inspect = useStore((s) => s.runs.tower?.inspect ?? null);
  const towers = useStore((s) => s.runs.tower?.towers);
  const heads = useStore((s) => s.runs.tower?.heads);
  const blocks = useStore((s) => s.runs.tower?.blocks);
  const heroHash = useStore((s) => s.runs.tower?.heroHash);
  const currentSlot = useStore((s) => s.runs.tower?.currentSlot ?? 0);
  const commitment = useStore((s) => s.runs.tower?.commitment ?? EMPTY_COMMITMENT);
  const selected = useStore((s) => s.selectedNode) ?? 0;
  if (!meta) return <p className="empty">Loading…</p>;
  const insp = inspect && inspect.protocol === 'tower' ? inspect : null;
  const tower = towers?.get(selected) ?? (insp && insp.node === selected ? { lockouts: insp.lockouts, root: insp.root, t: 0 } : null);
  const head = heads?.get(selected) ?? insp?.head ?? null;
  const nodes: ForkTreeNode[] = forkNodesFromBlocks(blocks ?? [], heads ?? new Map(), heroHash ?? null);
  if (insp?.forks) {
    const byHash = new Map(insp.forks.map((f) => [f.hash, f]));
    for (const n of nodes) {
      const f = byHash.get(n.hash);
      if (f) Object.assign(n, { weightPct: f.weight_pct, confirmed: f.confirmed, rooted: f.rooted });
    }
  }
  const noData = !tower && (blocks?.length ?? 0) === 0;
  return (
    <div className="tower-panel">
      <div className="row-between">
        <h3>{selected === null ? 'No node selected' : `Node ${selected}`} · lockout tower</h3>
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
          <LockoutBars lockouts={tower.lockouts} root={tower.root} currentSlot={currentSlot} />
        ) : (
          <p className="empty">Tower is empty (no votes yet).</p>
        )
      ) : (
        !noData && <p className="empty">This node has not voted yet.</p>
      )}
      <div className="row-between">
        <h3>Fork tree</h3>
        <span className="muted small">
          confirmed ≤ slot {commitment.confirmed < 0 ? '—' : commitment.confirmed} · finalized ≤ slot {commitment.finalized < 0 ? '—' : commitment.finalized}
        </span>
      </div>
      <ForkTree nodes={nodes} />
      <p className="muted small">Numbers inside a block = how many validators currently pick it as heaviest fork head. Hero block outlined.</p>
    </div>
  );
}

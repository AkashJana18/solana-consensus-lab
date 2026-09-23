import type { BlockInfo } from '../../store/runView';
import { shortHash } from '../../store/runView';

export interface ForkTreeNode {
  hash: number;
  slot: number;
  parent: number;
  leader?: number;
  weightPct?: number;
  confirmed?: boolean;
  rooted?: boolean;
  heads: number;
  hero?: boolean;
}

export function forkNodesFromBlocks(blocks: BlockInfo[], heads: ReadonlyMap<number, { slot: number; hash: number }>, heroHash: number | null): ForkTreeNode[] {
  const headCount = new Map<number, number>();
  for (const h of heads.values()) headCount.set(h.hash, (headCount.get(h.hash) ?? 0) + 1);
  return blocks.map((b) => ({ hash: b.hash, slot: b.slot, parent: b.parent, leader: b.leader, heads: headCount.get(b.hash) ?? 0, hero: heroHash === b.hash }));
}

/** Fork tree drawn as a slot-indexed lane diagram: one column per slot, forks spread vertically. */
export function ForkTree({ nodes }: { nodes: ForkTreeNode[] }) {
  if (nodes.length === 0) return <p className="empty">No blocks yet.</p>;
  const byHash = new Map(nodes.map((n) => [n.hash, n]));
  const slots = [...new Set(nodes.map((n) => n.slot))].sort((a, b) => a - b);
  const slotX = new Map(slots.map((s, i) => [s, i]));
  // Lane assignment: a child inherits its parent's lane; a competing sibling in the same
  // slot takes the next free lane, so forks fan out vertically.
  const lane = new Map<number, number>();
  const taken = new Set<string>();
  for (const n of [...nodes].sort((a, b) => a.slot - b.slot)) {
    let l = lane.get(n.parent) ?? 0;
    while (taken.has(`${l}:${n.slot}`)) l++;
    lane.set(n.hash, l);
    taken.add(`${l}:${n.slot}`);
  }
  const lanes = Math.max(0, ...lane.values()) + 1;
  const cw = 34;
  const rh = 30;
  const W = slots.length * cw + 20;
  const Hh = lanes * rh + 26;
  const cx = (s: number) => 14 + (slotX.get(s) ?? 0) * cw + cw / 2;
  const cy = (h: number) => 14 + (lane.get(h) ?? 0) * rh + rh / 2;
  return (
    <div className="forktree-wrap">
      <svg width={W} height={Hh} className="forktree">
        {nodes.map((n) => {
          const p = byHash.get(n.parent);
          if (!p) return null;
          return <line key={`e${n.hash}`} x1={cx(p.slot)} y1={cy(p.hash)} x2={cx(n.slot)} y2={cy(n.hash)} className="fork-edge" />;
        })}
        {nodes.map((n) => (
          <g key={n.hash} className={`fork-node ${n.rooted ? 'rooted' : ''} ${n.confirmed ? 'confirmed' : ''} ${n.hero ? 'hero' : ''}`}>
            <title>{`slot ${n.slot} · ${shortHash(n.hash)} · leader ${n.leader ?? '?'}${n.weightPct !== undefined ? ` · ${n.weightPct.toFixed(0)}% weight` : ''}${n.heads ? ` · head for ${n.heads} node(s)` : ''}`}</title>
            <circle cx={cx(n.slot)} cy={cy(n.hash)} r={n.heads ? 8 : 6} />
            {n.heads > 0 && (
              <text x={cx(n.slot)} y={cy(n.hash) + 3.5} textAnchor="middle" className="fork-heads">
                {n.heads}
              </text>
            )}
          </g>
        ))}
        {slots.map((s) => (
          <text key={s} x={cx(s)} y={Hh - 4} textAnchor="middle" className="tl-tick">
            {s}
          </text>
        ))}
      </svg>
    </div>
  );
}

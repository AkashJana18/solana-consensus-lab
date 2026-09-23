import type { SimMeta } from '../engine/types';

export interface NodePos {
  x: number;
  y: number;
  r: number;
  angle: number;
}

export interface RegionLabel {
  name: string;
  x: number;
  y: number;
  angle: number;
  count: number;
}

export interface Layout {
  cx: number;
  cy: number;
  ring: number;
  nodes: NodePos[];
  regions: RegionLabel[];
}

const TAU = Math.PI * 2;

/**
 * Validators clustered by region in arcs around a ring. Each region's arc is
 * proportional to its node count (with a fixed gap between regions); inside an
 * arc, nodes alternate slightly inside/outside the ring so big neighbours don't overlap.
 */
export function computeLayout(meta: SimMeta, width: number, height: number): Layout {
  const cx = width / 2;
  const cy = height / 2;
  // Leave room for the largest node + region label on every side.
  const ring = Math.max(40, Math.min(width / 2 - 104, height / 2 - 76));
  const byRegion: number[][] = meta.regions.map(() => []);
  meta.node_region.forEach((r, id) => byRegion[r]?.push(id));
  const occupied = byRegion.filter((g) => g.length > 0).length;
  const gap = occupied > 1 ? TAU * 0.035 : 0;
  const usable = TAU - gap * occupied;
  const total = meta.n || 1;

  const nodes: NodePos[] = new Array(meta.n);
  const regions: RegionLabel[] = [];
  let a = -Math.PI / 2 + gap / 2;
  byRegion.forEach((ids, ri) => {
    if (ids.length === 0) return;
    const span = (usable * ids.length) / total;
    const mid = a + span / 2;
    // Labels sit outside the outermost possible node edge (wobble + max radius).
    const labelR = ring * 1.06 + nodeRadius(1, ring) + 16;
    regions.push({
      name: meta.regions[ri],
      x: cx + Math.cos(mid) * labelR,
      y: cy + Math.sin(mid) * labelR,
      angle: mid,
      count: ids.length,
    });
    ids.forEach((id, i) => {
      const ang = ids.length === 1 ? mid : a + (span * (i + 0.5)) / ids.length;
      const wobble = ids.length > 3 ? (i % 2 === 0 ? -0.06 : 0.06) : 0;
      const rr = ring * (1 + wobble);
      nodes[id] = {
        x: cx + Math.cos(ang) * rr,
        y: cy + Math.sin(ang) * rr,
        r: nodeRadius(meta.stakes[id] / meta.total_stake, ring),
        angle: ang,
      };
    });
    a += span + gap;
  });
  return { cx, cy, ring, nodes, regions };
}

/** Node radius grows with sqrt(stake share) so area is proportional to stake. */
export function nodeRadius(share: number, ring: number): number {
  const scale = Math.min(1.4, Math.max(0.6, ring / 260));
  return Math.max(4, Math.min(22 * scale, (4 + 30 * Math.sqrt(Math.max(0, share))) * scale));
}

export function hitTest(layout: Layout, x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  layout.nodes.forEach((n, id) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= Math.max(n.r + 6, 12) && d < bestD) {
      best = id;
      bestD = d;
    }
  });
  return best;
}

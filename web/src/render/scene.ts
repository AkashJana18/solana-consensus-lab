import { Application, Container, Graphics, Text, TextStyle, type Texture } from 'pixi.js';
import type { SimMeta, TracedOf } from '../engine/types';
import { COLOR } from './colors';
import { kindColor, kindFamily } from './colors';
import { computeLayout, type Layout } from './layout';
import { ParticleSystem } from './particles';

export interface SceneState {
  leader: number | null;
  offline: ReadonlySet<number>;
  partition: number[][] | null;
  rpcNode: number | null;
  selected: number | null;
  heroSlot: number | null;
}

const EMPTY: SceneState = { leader: null, offline: new Set(), partition: null, rpcNode: null, selected: null, heroSlot: null };

/** Owns the Pixi display list for one protocol canvas. Pure rendering; no sim logic. */
export class Scene {
  readonly root = new Container();
  private guide = new Graphics();
  private dividers = new Graphics();
  private nodesG = new Graphics();
  private overlays = new Graphics();
  private labels = new Container();
  readonly particles: ParticleSystem;
  layout: Layout | null = null;
  private meta: SimMeta | null = null;
  private state: SceneState = EMPTY;
  private w = 0;
  private h = 0;
  private reduced: boolean;

  constructor(app: Application, reduced: boolean) {
    this.reduced = reduced;
    const coreTex = makeCircleTexture(app, 16, false);
    const glowTex = makeCircleTexture(app, 48, true);
    this.particles = new ParticleSystem(coreTex, glowTex, { cap: reduced ? 1500 : 6000, glow: !reduced });
    this.root.addChild(this.guide, this.dividers, this.particles.glows, this.nodesG, this.particles.cores, this.overlays, this.labels);
  }

  setMeta(meta: SimMeta | null): void {
    this.meta = meta;
    this.relayout();
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.relayout();
  }

  private relayout(): void {
    if (!this.meta || this.w === 0) return;
    this.layout = computeLayout(this.meta, this.w, this.h);
    this.particles.clear();
    this.drawStatic();
    this.drawNodes();
  }

  setState(s: SceneState): void {
    const prev = this.state;
    this.state = s;
    if (prev.offline !== s.offline || prev.selected !== s.selected || prev.leader !== s.leader || prev.rpcNode !== s.rpcNode) {
      this.drawNodes();
    }
    if (prev.partition !== s.partition) this.drawDividers();
  }

  private drawStatic(): void {
    const L = this.layout!;
    this.guide.clear();
    this.guide.circle(L.cx, L.cy, L.ring).stroke({ width: 1, color: COLOR.ringGuide, alpha: 1 });
    this.labels.removeChildren().forEach((c) => c.destroy());
    const style = new TextStyle({ fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: COLOR.region, letterSpacing: 0.4 });
    for (const r of L.regions) {
      const t = new Text({ text: r.name.toUpperCase(), style });
      t.anchor.set(0.5);
      t.x = r.x;
      t.y = r.y;
      // Tuck labels slightly further out on the horizontal extremes so they clear the ring.
      t.x += Math.cos(r.angle) * 18;
      this.labels.addChild(t);
    }
    this.drawDividers();
  }

  private drawDividers(): void {
    const g = this.dividers;
    g.clear();
    const L = this.layout;
    const parts = this.state.partition;
    if (!L || !parts || parts.length < 2) return;
    // Soft divider: shade each group's convex-ish hull region with a faint wash and draw
    // a dashed chord between group centroids' bisector.
    const centroids = parts.map((ids) => {
      let x = 0;
      let y = 0;
      for (const id of ids) {
        x += L.nodes[id]?.x ?? L.cx;
        y += L.nodes[id]?.y ?? L.cy;
      }
      const n = Math.max(1, ids.length);
      return { x: x / n, y: y / n };
    });
    for (let i = 1; i < centroids.length; i++) {
      const a = centroids[0];
      const b = centroids[i];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const ext = L.ring * 1.35;
      dashed(g, mx - nx * ext, my - ny * ext, mx + nx * ext, my + ny * ext, 10, 8);
      g.stroke({ width: 2, color: COLOR.partition, alpha: 0.55 });
    }
  }

  private drawNodes(): void {
    const L = this.layout;
    if (!L) return;
    const g = this.nodesG;
    const o = this.overlays;
    g.clear();
    o.clear();
    const { offline, selected, leader, rpcNode } = this.state;
    L.nodes.forEach((n, id) => {
      const off = offline.has(id);
      const alpha = off ? 0.25 : 1;
      g.circle(n.x, n.y, n.r).fill({ color: id === selected ? 0x3a4050 : COLOR.nodeFill, alpha });
      g.circle(n.x, n.y, n.r).stroke({ width: id === selected ? 2 : 1.25, color: id === selected ? COLOR.nodeSelected : COLOR.nodeStroke, alpha });
      if (id === leader) {
        o.circle(n.x, n.y, n.r + 5).stroke({ width: 2.5, color: COLOR.leader, alpha: off ? 0.4 : 1 });
        if (!this.reduced) o.circle(n.x, n.y, n.r + 10).stroke({ width: 6, color: COLOR.leader, alpha: 0.18 });
      }
      if (id === rpcNode) {
        // Small diamond tag marks the RPC node that received the hero tx.
        const s = 5;
        const x = n.x + n.r * 0.75;
        const y = n.y - n.r * 0.75;
        o.moveTo(x, y - s).lineTo(x + s, y).lineTo(x, y + s).lineTo(x - s, y).closePath().fill({ color: COLOR.rpc });
      }
    });
  }

  /** Emit a particle for a msg_sent event. */
  emit(msg: TracedOf<'msg_sent'>, heroSlot: number | null): void {
    const L = this.layout;
    if (!L) return;
    const a = L.nodes[msg.from];
    const b = L.nodes[msg.to];
    if (!a || !b || msg.from === msg.to) return;
    const fam = kindFamily(msg.kind);
    const hero = fam === 'hero';
    const heroShred = fam === 'shred' && heroSlot !== null && msg.slot === heroSlot;
    const glow = hero || heroShred || fam === 'cert';
    const size = hero ? 9 : fam === 'cert' ? 5 : heroShred ? 4.5 : fam === 'vote' ? 3 : 3.5;
    this.particles.emit(msg, a, b, kindColor(msg.kind), size, glow, hero || heroShred || fam === 'cert');
  }

  update(now: number): void {
    this.particles.update(now);
  }

  destroy(): void {
    this.particles.destroy();
    this.root.destroy({ children: true });
  }
}

function dashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
  }
}

function makeCircleTexture(app: Application, size: number, soft: boolean): Texture {
  const g = new Graphics();
  const r = size / 2;
  if (soft) {
    // Concentric rings approximate a radial falloff without a shader.
    for (let i = 6; i >= 1; i--) {
      g.circle(r, r, (r * i) / 6).fill({ color: 0xffffff, alpha: 0.12 });
    }
  } else {
    g.circle(r, r, r - 1).fill({ color: 0xffffff });
  }
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

import { Particle, ParticleContainer, type Texture } from 'pixi.js';
import type { TracedOf } from '../engine/types';
import { particleState, pointOnPath, type Point } from './interp';

type MsgSent = TracedOf<'msg_sent'>;

interface Live {
  t: number;
  arriveAt: number;
  dropped: boolean;
  a: Point;
  b: Point;
  core: Particle;
  glow: Particle | null;
  baseAlpha: number;
}

export interface ParticleOptions {
  cap: number;
  glow: boolean;
}

/**
 * Pooled particle renderer. Every message is one `Particle` in a single
 * `ParticleContainer` (plus an optional additive glow sprite for hero shreds and
 * certificates). Nothing here touches the DOM; the pool is capped so a 60k-message
 * run can never allocate unboundedly.
 */
export class ParticleSystem {
  readonly cores: ParticleContainer;
  readonly glows: ParticleContainer;
  private live: Live[] = [];
  private pool: Live[] = [];
  private opts: ParticleOptions;

  constructor(
    private coreTex: Texture,
    private glowTex: Texture,
    opts: ParticleOptions,
  ) {
    this.opts = opts;
    this.cores = new ParticleContainer({
      dynamicProperties: { position: true, color: true, vertex: true, rotation: false, uvs: false },
    });
    this.glows = new ParticleContainer({
      dynamicProperties: { position: true, color: true, vertex: true, rotation: false, uvs: false },
      blendMode: 'add',
    });
  }

  setOptions(opts: ParticleOptions): void {
    this.opts = opts;
  }

  get count(): number {
    return this.live.length;
  }

  /** Returns false when the cap is reached and the particle was skipped. */
  emit(msg: MsgSent, a: Point, b: Point, color: number, size: number, glow: boolean, priority: boolean): boolean {
    if (this.live.length >= this.opts.cap && !priority) return false;
    const item = this.pool.pop() ?? this.fresh();
    item.t = msg.t;
    item.arriveAt = msg.arrive_at;
    item.dropped = !!msg.dropped;
    item.a = a;
    item.b = b;
    item.baseAlpha = glow ? 1 : 0.85;
    const c = item.core;
    c.tint = color;
    c.scaleX = c.scaleY = size / 16;
    c.alpha = 0;
    c.x = a.x;
    c.y = a.y;
    this.cores.addParticle(c);
    if (glow && this.opts.glow) {
      const g = item.glow ?? new Particle({ texture: this.glowTex, anchorX: 0.5, anchorY: 0.5 });
      item.glow = g;
      g.tint = color;
      g.scaleX = g.scaleY = (size * 3) / 48;
      g.alpha = 0;
      g.x = a.x;
      g.y = a.y;
      this.glows.addParticle(g);
    } else {
      item.glow = null;
    }
    this.live.push(item);
    return true;
  }

  private fresh(): Live {
    return {
      t: 0,
      arriveAt: 0,
      dropped: false,
      a: { x: 0, y: 0 },
      b: { x: 0, y: 0 },
      core: new Particle({ texture: this.coreTex, anchorX: 0.5, anchorY: 0.5 }),
      glow: null,
      baseAlpha: 1,
    };
  }

  update(now: number): void {
    const live = this.live;
    let w = 0;
    for (let i = 0; i < live.length; i++) {
      const it = live[i];
      const s = particleState(it.t, it.arriveAt, it.dropped, now);
      if (!s.alive || now < it.t) {
        // Also recycle anything from the future (after a backwards scrub).
        this.recycle(it);
        continue;
      }
      const pt = pointOnPath(it.a, it.b, s.p);
      it.core.x = pt.x;
      it.core.y = pt.y;
      it.core.alpha = s.alpha * it.baseAlpha;
      if (it.glow) {
        it.glow.x = pt.x;
        it.glow.y = pt.y;
        it.glow.alpha = s.alpha * 0.55;
      }
      live[w++] = it;
    }
    live.length = w;
  }

  private recycle(it: Live): void {
    this.cores.removeParticle(it.core);
    if (it.glow) this.glows.removeParticle(it.glow);
    it.glow = null;
    this.pool.push(it);
  }

  clear(): void {
    for (const it of this.live) this.recycle(it);
    this.live.length = 0;
  }

  destroy(): void {
    this.clear();
    this.cores.destroy();
    this.glows.destroy();
  }
}

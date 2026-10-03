import { Application } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { controller } from '../engine/controller';
import type { Protocol } from '../engine/types';
import type { RunView } from '../store/runView';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useStore } from '../store/useStore';
import { PROTOCOL_LABEL } from '../util/format';
import { COLOR, HEX } from './colors';
import { hitTest } from './layout';
import { Scene } from './scene';

const LEGEND: { label: string; color: string; glow?: boolean }[] = [
  { label: 'shreds', color: HEX.shred },
  { label: 'votes', color: HEX.vote },
  { label: 'certificates', color: HEX.cert },
  { label: 'repair', color: HEX.repair },
  { label: 'hero tx', color: HEX.hero, glow: true },
];

/** One sentence describing what the canvas is currently showing, for assistive tech. */
function describe(protocol: Protocol, run: RunView | undefined, selected: number | null): string {
  if (!run?.meta) return `${PROTOCOL_LABEL[protocol]} network, loading`;
  const bits = [`slot ${run.currentSlot}`, `leader ${run.leader ?? 'unknown'}`, `${run.meta.n} validators`];
  if (run.offline.size) bits.push(`${run.offline.size} offline`);
  if (run.partition) bits.push('network partitioned');
  if (run.heroSlot !== null) bits.push(`hero tx in slot ${run.heroSlot}`);
  bits.push(selected === null ? 'no node selected' : `node ${selected} selected`);
  return `${PROTOCOL_LABEL[protocol]} network: ${bits.join(', ')}`;
}

/** Mounts one Pixi application for a protocol and wires clicks to node selection. */
export function CanvasView({ protocol }: { protocol: Protocol }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const run = useStore((s) => s.runs[protocol]);
  const selected = useStore((s) => s.selectedNode);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let app: Application | null = null;
    let scene: Scene | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;
    const onClick = (ev: PointerEvent) => {
      if (!scene?.layout) return;
      const rect = el.getBoundingClientRect();
      const id = hitTest(scene.layout, ev.clientX - rect.left, ev.clientY - rect.top);
      if (id !== null) {
        useStore.getState().set({ selectedNode: id });
        controller.poll(true);
      }
    };
    void (async () => {
      const a = new Application();
      await a.init({
        background: COLOR.canvas,
        antialias: true,
        resizeTo: el,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
      });
      if (disposed) {
        a.destroy(true);
        return;
      }
      app = a;
      a.canvas.classList.add('sim-canvas');
      a.canvas.setAttribute('data-protocol', protocol);
      el.appendChild(a.canvas);
      scene = new Scene(a, reduced);
      a.stage.addChild(scene.root);
      scene.resize(el.clientWidth, el.clientHeight);
      controller.attachScene(protocol, scene);
      ro = new ResizeObserver(() => {
        scene?.resize(el.clientWidth, el.clientHeight);
        // Pixi's `resizeTo` only listens to window resize, so layout-driven size
        // changes (lesson panel opening/closing, mode switches) must resize the
        // renderer by hand or the scene is laid out wider than the canvas.
        app?.resize();
      });
      ro.observe(el);
      a.canvas.addEventListener('pointerdown', onClick);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      controller.attachScene(protocol, null);
      app?.canvas.removeEventListener('pointerdown', onClick);
      scene?.destroy();
      app?.destroy(true);
    };
  }, [protocol, reduced]);

  // A Pixi canvas carries no accessible name of its own, so give it one built from the
  // state it is drawing. Assigned in an effect because the element is created by Pixi.
  const label = describe(protocol, run, selected);
  useEffect(() => {
    const canvas = host.current?.querySelector('canvas');
    if (!canvas) return;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
  }, [label]);

  const meta = run?.meta;
  const leader = run?.leader;
  return (
    <div className="canvas-wrap">
      <div className="canvas-host" ref={host} />
      <header className="canvas-caption">
        <span className={`proto-tag proto-${protocol}`}>{PROTOCOL_LABEL[protocol]}</span>
        {meta && (
          <span className="muted">
            slot <b>{run?.currentSlot ?? 0}</b> · leader <b>{leader ?? '—'}</b>
            {selected !== null && (
              <>
                {' '}
                · selected <b>node {selected}</b>
              </>
            )}
          </span>
        )}
        {run?.error && <span className="error-chip">{run.error}</span>}
      </header>
      <ul className="legend" aria-label="Particle legend">
        {LEGEND.map((l) => (
          <li key={l.label}>
            <i style={{ background: l.color, boxShadow: l.glow ? `0 0 6px ${l.color}` : 'none' }} />
            {l.label}
          </li>
        ))}
        <li>
          <i className="legend-ring" /> leader
        </li>
        <li>
          <i className="legend-rpc" /> RPC node
        </li>
      </ul>
    </div>
  );
}

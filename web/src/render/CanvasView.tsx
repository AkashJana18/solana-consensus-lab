import { Application } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { controller } from '../engine/controller';
import type { Protocol } from '../engine/types';
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
      ro = new ResizeObserver(() => scene?.resize(el.clientWidth, el.clientHeight));
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

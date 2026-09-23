import { useCallback, useRef } from 'react';
import { controller } from '../engine/controller';
import type { Fault, Protocol, SimMeta } from '../engine/types';
import { TX_STAGES } from '../engine/txStages';
import { useSize } from '../hooks/useSize';
import { protocolsFor, useStore } from '../store/useStore';
import { PROTOCOL_LABEL } from '../util/format';

const H = 92;
// Left gutter holds the per-protocol row labels so they never collide with early stage markers.
const PAD_L = 76;
const PAD_R = 8;
// Muted band fills: identity of a leader is carried by its label; colour only separates neighbours.
const BAND = ['#2b3a55', '#3b3550', '#2f4a45', '#4a3b2f', '#3f2f4a', '#2f4457', '#4a4a2f', '#3a2f2f'];

export function Timeline() {
  const host = useRef<HTMLDivElement>(null);
  const { width } = useSize(host);
  const mode = useStore((s) => s.mode);
  const runs = useStore((s) => s.runs);
  const displayTime = useStore((s) => s.displayTime);
  const end = useStore((s) => s.end);
  const protocols = protocolsFor(mode);
  const meta = runs[protocols[0]]?.meta ?? null;
  const W = Math.max(0, width - PAD_L - PAD_R);
  const x = (us: number) => PAD_L + (end > 0 ? (us / end) * W : 0);
  const tOf = (px: number) => (end > 0 ? ((px - PAD_L) / Math.max(1, W)) * end : 0);

  const scrub = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const rect = ev.currentTarget.getBoundingClientRect();
      controller.seek(Math.max(0, Math.min(end, tOf(ev.clientX - rect.left))));
    },
    [end, W], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <footer className="timeline" ref={host} aria-label="Timeline">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          data-testid="timeline"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            controller.pause();
            scrub(e);
          }}
          onPointerMove={(e) => e.buttons & 1 && scrub(e)}
        >
          {meta && <LeaderBands meta={meta} x={x} />}
          {meta && <FaultBands faults={meta.scenario.faults} end={end} x={x} />}
          {meta && <SlotTicks meta={meta} x={x} end={end} />}
          {protocols.map((p, i) => (
            <StageMarkers key={p} protocol={p} y={14 + i * 13} x={x} />
          ))}
          <line x1={x(displayTime)} x2={x(displayTime)} y1={0} y2={H} stroke="#ffffff" strokeWidth={1.5} />
          <polygon points={`${x(displayTime) - 5},0 ${x(displayTime) + 5},0 ${x(displayTime)},7`} fill="#ffffff" />
        </svg>
      )}
    </footer>
  );
}

function LeaderBands({ meta, x }: { meta: SimMeta; x: (us: number) => number }) {
  const winUs = meta.window * meta.slot_ms * 1000;
  return (
    <g>
      {meta.leaders.map((leader, w) => {
        const x0 = x(w * winUs);
        const x1 = Math.min(x(meta.duration_us), x((w + 1) * winUs));
        if (x1 <= x0) return null;
        return (
          <g key={w}>
            <rect x={x0 + 1} y={46} width={Math.max(0, x1 - x0 - 2)} height={20} rx={3} fill={BAND[leader % BAND.length]} />
            {x1 - x0 > 26 && (
              <text x={(x0 + x1) / 2} y={60} textAnchor="middle" className="tl-label">
                L{leader}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function SlotTicks({ meta, x, end }: { meta: SimMeta; x: (us: number) => number; end: number }) {
  const slotUs = meta.slot_ms * 1000;
  const n = Math.floor(end / slotUs);
  const every = n > 40 ? 5 : n > 20 ? 2 : 1;
  const ticks = [];
  for (let s = 0; s <= n; s++) {
    const px = x(s * slotUs);
    const major = s % every === 0;
    ticks.push(<line key={s} x1={px} x2={px} y1={major ? 68 : 72} y2={78} stroke={major ? '#6b7387' : '#3a3f4b'} />);
    if (major) {
      ticks.push(
        <text key={`t${s}`} x={px} y={89} textAnchor="middle" className="tl-tick">
          {s}
        </text>,
      );
    }
  }
  return <g>{ticks}</g>;
}

function FaultBands({ faults, end, x }: { faults: Fault[]; end: number; x: (us: number) => number }) {
  return (
    <g>
      {faults.map((f, i) => {
        const from = f.from_ms * 1000;
        const to = ('to_ms' in f && f.to_ms != null ? f.to_ms : end / 1000) * 1000;
        const fill = f.kind === 'partition' ? '#9085e9' : f.kind === 'offline' ? '#e66767' : '#c98500';
        return (
          <g key={i}>
            <rect x={x(from)} y={6} width={Math.max(2, x(to) - x(from))} height={H - 6} fill={fill} opacity={0.12} />
            <rect x={x(from)} y={6} width={Math.max(2, x(to) - x(from))} height={2} fill={fill} opacity={0.9} />
            <text x={x(from) + 4} y={42} className="tl-fault" fill={fill}>
              {f.kind}
              {f.kind === 'offline' && 'leader_of_slot' in f.target ? ` (leader of slot ${f.target.leader_of_slot})` : ''}
              {f.kind === 'offline' && 'stake_pct' in f.target ? ` (${Math.round(f.target.stake_pct * 100)}% stake)` : ''}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function StageMarkers({ protocol, y, x }: { protocol: Protocol; y: number; x: (us: number) => number }) {
  const stages = useStore((s) => s.runs[protocol]?.txStages);
  if (!stages) return null;
  return (
    <g>
      <text x={8} y={y + 4} className="tl-proto">
        {PROTOCOL_LABEL[protocol]}
      </text>
      <line x1={PAD_L} x2="100%" y1={y} y2={y} className="tl-stage-rail" />
      {TX_STAGES.map((st) => {
        const hit = stages[st];
        if (!hit) return null;
        const fill = st === 'finalized' ? '#0ca30c' : st === 'confirmed' ? '#fab219' : '#ffffff';
        return (
          <g key={st}>
            <title>{`${st} @ ${(hit.t / 1000).toFixed(1)} ms`}</title>
            <circle cx={x(hit.t)} cy={y} r={st === 'finalized' || st === 'confirmed' ? 4.5 : 3} fill={fill} stroke="#14161b" strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
}

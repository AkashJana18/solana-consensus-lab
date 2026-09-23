import { useEffect, useState } from 'react';
import { controller } from '../engine/controller';
import { loadScenario } from '../engine/wasmMain';
import { SPEEDS, useStore, type Mode } from '../store/useStore';
import { slotOf } from '../util/format';

const MODES: { id: Mode; label: string }[] = [
  { id: 'alpenglow', label: 'Alpenglow' },
  { id: 'tower', label: 'TowerBFT' },
  { id: 'compare', label: 'Compare' },
];

export function TopBar() {
  const s = useStore();
  const slotMs = s.runs.alpenglow?.meta?.slot_ms ?? s.runs.tower?.meta?.slot_ms ?? 400;
  const [seedText, setSeedText] = useState(String(s.seed));
  useEffect(() => setSeedText(String(s.seed)), [s.seed]);

  const onScenario = (value: string) => {
    if (value === '__custom') {
      s.set({ customOpen: true });
      return;
    }
    const json = loadScenario(value);
    if (json) s.set({ scenarioName: value, scenarioJson: json, isCustom: false });
  };

  const commitSeed = () => {
    const n = Number.parseInt(seedText, 10);
    if (Number.isFinite(n) && n >= 0 && n !== s.seed) s.set({ seed: n });
    else setSeedText(String(s.seed));
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span>
          Solana <b>Consensus Lab</b>
        </span>
      </div>

      <label className="field">
        <span>Scenario</span>
        <select value={s.isCustom ? '__custom' : s.scenarioName} onChange={(e) => onScenario(e.target.value)} data-testid="scenario-select">
          {s.scenarioNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="__custom">custom JSON…</option>
        </select>
      </label>

      <div className="segmented" role="radiogroup" aria-label="Protocol mode">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={s.mode === m.id} className={s.mode === m.id ? 'on' : ''} onClick={() => s.set({ mode: m.id })} data-testid={`mode-${m.id}`}>
            {m.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Seed</span>
        <input
          className="seed"
          inputMode="numeric"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
          onBlur={commitSeed}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Seed"
        />
      </label>

      <div className="transport">
        <button className="primary" onClick={() => controller.toggle()} data-testid="play" aria-label={s.playing ? 'Pause' : 'Play'} title="Space">
          {s.playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => controller.stepEvent()} title="Step one engine event (.)" data-testid="step-event">
          <span aria-hidden>⏵</span>
          <span className="lbl"> event</span>
        </button>
        <button onClick={() => controller.stepSlot()} title="Advance one slot (→)" data-testid="step-slot">
          <span aria-hidden>⏵⏵</span>
          <span className="lbl"> slot</span>
        </button>
        <select value={s.speed} onChange={(e) => s.set({ speed: Number(e.target.value) })} aria-label="Playback speed" data-testid="speed">
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </div>

      <div className="readout" aria-live="off" data-testid="readout">
        <span className="readout-time">{(s.displayTime / 1000).toFixed(1)}</span>
        <span className="muted"> ms</span>
        <span className="readout-slot">slot {slotOf(s.displayTime, slotMs)}</span>
      </div>
    </header>
  );
}

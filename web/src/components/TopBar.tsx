import { useEffect, useState } from 'react';
import { controller } from '../engine/controller';
import { loadScenario } from '../engine/wasmMain';
import { SPEEDS, useStore, type Mode } from '../store/useStore';
import { isShareable, shareUrl } from '../url/sync';
import { slotOf } from '../util/format';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'alpenglow', label: 'Alpenglow', hint: 'Alpenglow only (SIMD-0326)' },
  { id: 'tower', label: 'TowerBFT', hint: 'TowerBFT only, the current mainnet protocol' },
  { id: 'compare', label: 'Compare', hint: 'Both protocols side by side on the same scenario' },
];

/**
 * The clock has its own subscription so a running simulation does not reconcile the
 * scenario select, the seed input and five buttons on every store flush just to move
 * two digits. TopBar itself then only re-renders when one of its own fields changes.
 */
function ClockReadout() {

  const displayTime = useStore((s) => s.displayTime);
  const slotMs = useStore((s) => s.runs.alpenglow?.meta?.slot_ms ?? s.runs.tower?.meta?.slot_ms ?? 400);
  return (
    <div className="readout" aria-live="off" data-testid="readout">
      <span className="readout-time">{(displayTime / 1000).toFixed(1)}</span>
      <span className="muted"> ms</span>
      <span className="readout-slot">slot {slotOf(displayTime, slotMs)}</span>
    </div>
  );
}

export function TopBar() {


  // Narrow selectors, not useStore(): the controller writes displayTime on nearly every
  // 15 Hz flush, and a whole-store subscription reconciles both selects, the seed input
  // and five buttons each time just to move the clock readout.
  const scenarioNames = useStore((s) => s.scenarioNames);
  const scenarioName = useStore((s) => s.scenarioName);
  const isCustom = useStore((s) => s.isCustom);
  const mode = useStore((s) => s.mode);
  const seed = useStore((s) => s.seed);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const lesson = useStore((s) => s.lesson);
  const set = useStore((s) => s.set);

  const [seedText, setSeedText] = useState(String(seed));
  useEffect(() => setSeedText(String(seed)), [seed]);

  const onScenario = (value: string) => {
    if (value === '__custom') {
      set({ customOpen: true });
      return;
    }
    const json = loadScenario(value);
    if (json) set({ scenarioName: value, scenarioJson: json, isCustom: false });
  };

  const commitSeed = () => {
    const n = Number.parseInt(seedText, 10);
    if (Number.isFinite(n) && n >= 0 && n !== seed) set({ seed: n });
    else setSeedText(String(seed));
  };

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const share = async () => {
    const state = useStore.getState();
    if (!isShareable(state)) {
      setToast('This browser cannot encode a custom scenario into a link');
      return;
    }
    try {
      const url = await shareUrl(state, controller.time);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setToast('Link copied');
      } else window.prompt('Copy this link', url);
    } catch (e) {
      setToast(`Could not build link: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span>
          Solana <b>Consensus Lab</b>
        </span>
      </div>

      <label className="field" data-tip="Scenario">
        <span>Scenario</span>
        <select value={isCustom ? '__custom' : scenarioName} onChange={(e) => onScenario(e.target.value)} data-testid="scenario-select">
          {scenarioNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="__custom">custom JSON…</option>
        </select>
      </label>

      <div className="segmented" role="radiogroup" aria-label="Protocol mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            className={mode === m.id ? 'on' : ''}
            onClick={() => set({ mode: m.id })}
            data-tip={m.hint}
            data-testid={`mode-${m.id}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="field" data-tip="Seed">
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

      <button onClick={() => set({ lessonsOpen: true })} data-tip="Guided lessons" data-testid="lessons-open" className={lesson ? 'on' : ''}>
        <span aria-hidden>☰</span>
        <span className="lbl"> Lessons</span>
      </button>

      <div className="transport">
        <div className="share-anchor">
          <button onClick={() => void share()} data-tip="Copy a link to this exact moment" data-testid="share">
            <span aria-hidden>⧉</span>
            <span className="lbl"> Share</span>
          </button>
          {toast && (
            <span className="toast" role="status" data-testid="share-toast">
              {toast}
            </span>
          )}
        </div>
        <button className="primary" onClick={() => controller.toggle()} data-testid="play" aria-label={playing ? 'Pause' : 'Play'} data-tip={`${playing ? 'Pause' : 'Play'} (Space)`}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => controller.stepEvent()} data-tip="Step one engine event (.)" data-testid="step-event">
          <span aria-hidden>⏵</span>
          <span className="lbl"> event</span>
        </button>
        <button onClick={() => controller.stepSlot()} data-tip="Advance one slot (→)" data-testid="step-slot">
          <span aria-hidden>⏵⏵</span>
          <span className="lbl"> slot</span>
        </button>
        <select value={speed} onChange={(e) => set({ speed: Number(e.target.value) })} aria-label="Playback speed" data-tip="Playback speed" data-testid="speed">
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </div>

      <ClockReadout />
    </header>
  );
}

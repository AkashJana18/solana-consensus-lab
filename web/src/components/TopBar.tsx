import { useEffect, useState } from 'react';
import { Brand } from './Brand';
import { controller } from '../engine/controller';
import { loadScenario } from '../engine/wasmMain';
import { SPEEDS, useStore, type Mode } from '../store/useStore';
import { isShareable, shareUrl } from '../url/sync';
import { slotOf } from '../util/format';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'alpenglow', label: 'Alpenglow', hint: 'Alpenglow only (SIMD-0326)' },
  { id: 'tower', label: 'TowerBFT', hint: 'TowerBFT only, the current mainnet protocol' },
  { id: 'compare', label: 'Compare', hint: 'Both protocols side by side on the same scenario' },
  { id: 'live', label: 'Devnet', hint: 'Trace a real transaction on devnet. Alpenglow runs there today; the votes stay off-chain' },
];

/** The public repo this lab is built from. The link and the star count both key off it. */
const REPO = 'AkashJana18/solana-consensus-lab';

const STARS_KEY = 'scl.stars';
/** How long a fetched count is good for. Stars move slowly; the quota is 60/h per IP. */
const STARS_TTL_MS = 60 * 60 * 1000;

/** `n` is the last count we ever saw, `retryAt` is when we may ask again. */
interface StarCache {
  n: number | null;
  retryAt: number;
}

function readStars(): StarCache | null {
  try {
    const raw = localStorage.getItem(STARS_KEY);
    return raw ? (JSON.parse(raw) as StarCache) : null;
  } catch {
    // Private mode, disabled storage, or a corrupt entry: all mean "no cache", not a crash.
    return null;
  }
}

function writeStars(n: number | null, retryAt: number): void {
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify({ n, retryAt }));
  } catch {
    /* no cache is better than an exception on every page load */
  }
}

/**
 * The star count, fetched from api.github.com. Every part of it is defensive, because the
 * request is anonymous and free to fail:
 *
 * - The anonymous limit is 60/h per IP, and an IP is shared by everyone behind an office
 *   NAT or a proxy, so a 403 is a normal state to be in rather than an edge case.
 * - The last known count is cached and kept on failure: a stale number beats a missing one,
 *   and a link that never asks again beats a link that asks on every page load.
 * - On a 403 or 429 the wait comes from GitHub's own x-ratelimit-reset, so this browser
 *   stops asking the moment the quota is actually back.
 * - Under automation (`navigator.webdriver`, i.e. the Playwright suite) the request is
 *   skipped entirely: the tests must not spend a third party's quota, and a failed request
 *   logs a console error that ten of the specs assert against. The chip then shows the mark
 *   with no number, which is the same state a rate-limited visitor gets.
 */
function useStarCount(): number | null {
  const [stars, setStars] = useState(() => readStars()?.n ?? null);

  useEffect(() => {
    const cached = readStars();
    if (Date.now() < (cached?.retryAt ?? 0)) return;
    if (navigator.webdriver) return;

    const ac = new AbortController();
    fetch(`https://api.github.com/repos/${REPO}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) {
          // GitHub says when the quota is back; if it does not, wait the usual hour.
          const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
          const wait = Number.isFinite(reset) && reset > Date.now() ? reset - Date.now() : STARS_TTL_MS;
          writeStars(cached?.n ?? null, Date.now() + wait);
          return null;
        }
        const j = (await r.json()) as { stargazers_count?: unknown };
        const n = typeof j.stargazers_count === 'number' ? j.stargazers_count : null;
        writeStars(n, Date.now() + STARS_TTL_MS);
        setStars(n);
        return n;
      })
      // Offline, DNS failure, or an unmount abort. Keep the cached number, ask again in an
      // hour. The browser logs this one to the console whatever we do; it happens at most
      // once an hour per browser.
      .catch(() => writeStars(cached?.n ?? null, Date.now() + STARS_TTL_MS));
    return () => ac.abort();
  }, []);
  return stars;
}

/**
 * Its own component, for the same reason as the clock: the count arrives long after mount
 * and must not reconcile the scenario select and the seed input to change two digits.
 *
 * The mark is GitHub's mark-github glyph and the star is octicons' star, both at 16px, so
 * the pair is the familiar "repo + stars" chip.
 */
function RepoLink() {
  const stars = useStarCount();
  return (
    <a
      className="repo-link"
      href={`https://github.com/${REPO}`}
      target="_blank"
      rel="noreferrer"
      data-tip={stars === null ? 'View the source on GitHub' : `View the source on GitHub · ${stars} ${stars === 1 ? 'star' : 'stars'}`}
      aria-label={stars === null ? 'Solana Consensus Lab on GitHub' : `Solana Consensus Lab on GitHub, ${stars} ${stars === 1 ? 'star' : 'stars'}`}
      data-testid="repo-link"
    >
      <svg className="repo-mark" viewBox="0 0 16 16" aria-hidden focusable="false" role="presentation">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 012-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      <span className="repo-stars">
        <svg className="repo-star" viewBox="0 0 16 16" aria-hidden focusable="false" role="presentation">
          <path
            fill="currentColor"
            d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.751.751 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"
          />
        </svg>
        <span className="repo-count" data-testid="repo-stars">
          {stars ?? ''}
        </span>
      </span>
    </a>
  );
}

/**
 * The clock has its own subscription so a running simulation does not reconcile the
 * scenario select, the seed input and five buttons on every store flush just to move
 * two digits. TopBar itself then only re-renders when one of its own fields changes.
 */
function ClockReadout() {

  const displayTime = useStore((s) => s.displayTime);
  const slotMs = useStore((s) => s.runs.alpenglow?.meta?.slot_ms ?? s.runs.tower?.meta?.slot_ms ?? s.runs.live?.meta?.slot_ms ?? 400);
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
        <Brand />
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

      {/* aria-label on every button whose only text is a .lbl: those collapse at 1520px,
          and display: none takes the name out of the accessibility tree with them. */}
      <button onClick={() => set({ lessonsOpen: true })} data-tip="Guided lessons" data-testid="lessons-open" className={lesson ? 'on' : ''} aria-label="Lessons">
        <span aria-hidden>☰</span>
        <span className="lbl"> Lessons</span>
      </button>

      <div className="transport">
        <div className="share-anchor">
          <button onClick={() => void share()} data-tip="Copy a link to this exact moment" data-testid="share" aria-label="Share">
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
        <button onClick={() => controller.stepEvent()} data-tip="Step one engine event (.)" data-testid="step-event" aria-label="Step one event">
          <span aria-hidden>⏵</span>
          <span className="lbl"> event</span>
        </button>
        <button onClick={() => controller.stepSlot()} data-tip="Advance one slot (→)" data-testid="step-slot" aria-label="Advance one slot">
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

      <RepoLink />
    </header>
  );
}

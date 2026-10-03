// Keeps the address bar in sync with the store (history.replaceState, debounced)
// and builds the link the Share button copies.
import { useStore, type LabState } from '../store/useStore';
import { canCompress, compressScenario, formatUrlState, parseUrlState, type UrlState } from './state';

/**
 * scenarioJson -> compressed form, so the URL can be rewritten synchronously once known.
 * Only the current custom scenario is ever needed, and a session can edit it many times,
 * so this keeps just the latest: keyed by the full JSON it grew without bound.
 */
let compressedJson: string | null = null;
let compressedValue: string | null = null;

function compressedFor(json: string): string | undefined {
  return compressedJson === json ? compressedValue ?? undefined : undefined;
}

function rememberCompressed(json: string, value: string): void {
  compressedJson = json;
  compressedValue = value;
}

/** Last display time (µs) the clock was paused at; `t` in the URL never tracks a playing clock. */
let pausedTimeUs: number | null = null;

export function currentUrlState(s: LabState, tUs: number | null): UrlState {
  const st: UrlState = {};
  if (s.isCustom) {
    const c = compressedFor(s.scenarioJson);
    if (c) st.s = c;
  } else st.scenario = s.scenarioName;
  st.seed = s.seed;
  st.mode = s.mode;
  // A lesson owns the clock: it stops at its own recorded hit times, so a `t` carried
  // over from before the lesson opened disagrees with what the lesson is showing.
  if (tUs !== null && !s.lesson) st.tMs = tUs / 1000;
  st.node = s.selectedNode;
  if (s.tab !== 'transaction') st.tab = s.tab;
  if (s.speed !== 1) st.speed = s.speed;
  if (s.lesson) {
    st.lesson = s.lesson.id;
    if (s.lesson.step >= 0) st.step = s.lesson.step;
  }
  return st;
}

/** Whether the current scenario can be encoded in a link at all. */
export function isShareable(s: LabState): boolean {
  return !s.isCustom || canCompress;
}

/** Full absolute link for the current state at sim time `tUs`. Compresses a custom scenario on demand. */
export async function shareUrl(s: LabState, tUs: number): Promise<string> {
  if (s.isCustom && !compressedFor(s.scenarioJson)) rememberCompressed(s.scenarioJson, await compressScenario(s.scenarioJson));
  return location.origin + location.pathname + formatUrlState(currentUrlState(s, tUs)) + location.hash;
}

/** Start mirroring the store into the URL. Returns a stop function. */
export function startUrlSync(): () => void {
  const initial = parseUrlState(location.search);
  // Mirrors the boot path in App.tsx: `t` is ignored when the URL also names a lesson.
  pausedTimeUs = initial.tMs === undefined || initial.lesson ? null : Math.round(initial.tMs * 1000);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: string | null = null;

  const write = () => {
    timer = null;
    const s = useStore.getState();
    if (!s.wasmReady) return;
    const qs = formatUrlState(currentUrlState(s, pausedTimeUs));
    if (qs === last) return;
    last = qs;
    history.replaceState(null, '', location.pathname + qs + location.hash);
  };
  const schedule = () => {
    if (timer === null) timer = setTimeout(write, 250);
  };

  const unsub = useStore.subscribe((s, prev) => {
    if (!s.wasmReady) return;
    if (s.isCustom && canCompress && !compressedFor(s.scenarioJson)) {
      const json = s.scenarioJson;
      void compressScenario(json)
        .then((c) => {
          rememberCompressed(json, c);
          schedule();
        })
        .catch(() => undefined);
    }
    // Only a paused clock is worth linking to; while playing, keep the last paused time.
    if (!s.playing && s.restoreTimeUs === null && (s.displayTime !== prev.displayTime || prev.playing)) pausedTimeUs = s.displayTime;
    schedule();
  });

  return () => {
    unsub();
    if (timer !== null) clearTimeout(timer);
  };
}

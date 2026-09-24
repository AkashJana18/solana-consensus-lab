// Keeps the address bar in sync with the store (history.replaceState, debounced)
// and builds the link the Share button copies.
import { useStore, type LabState } from '../store/useStore';
import { canCompress, compressScenario, formatUrlState, parseUrlState, type UrlState } from './state';

/** scenarioJson -> compressed form, so the URL can be rewritten synchronously once known. */
const compressed = new Map<string, string>();

/** Last display time (µs) the clock was paused at; `t` in the URL never tracks a playing clock. */
let pausedTimeUs: number | null = null;

export function currentUrlState(s: LabState, tUs: number | null): UrlState {
  const st: UrlState = {};
  if (s.isCustom) {
    const c = compressed.get(s.scenarioJson);
    if (c) st.s = c;
  } else st.scenario = s.scenarioName;
  st.seed = s.seed;
  st.mode = s.mode;
  if (tUs !== null) st.tMs = tUs / 1000;
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
  if (s.isCustom && !compressed.has(s.scenarioJson)) compressed.set(s.scenarioJson, await compressScenario(s.scenarioJson));
  return location.origin + location.pathname + formatUrlState(currentUrlState(s, tUs)) + location.hash;
}

/** Start mirroring the store into the URL. Returns a stop function. */
export function startUrlSync(): () => void {
  const initial = parseUrlState(location.search).tMs;
  pausedTimeUs = initial === undefined ? null : Math.round(initial * 1000);

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
    if (s.isCustom && canCompress && !compressed.has(s.scenarioJson)) {
      const json = s.scenarioJson;
      void compressScenario(json)
        .then((c) => {
          compressed.set(json, c);
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

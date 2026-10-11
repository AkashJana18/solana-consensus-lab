// Shareable-link state: pure encode/decode of the query string, plus optional
// compression of custom scenario JSON. Times in the URL are MILLISECONDS (`t`),
// the store keeps microseconds; convert at the boundary.
import { SPEEDS, type Mode, type Tab } from '../store/useStore';

const MODES: readonly Mode[] = ['alpenglow', 'tower', 'compare'];
const TABS: readonly Tab[] = ['transaction', 'votor', 'tower', 'events', 'metrics'];

export interface UrlState {
  /** Builtin scenario name. Ignored when `s` is present. */
  scenario?: string;
  /** Custom scenario JSON, deflate-raw compressed and base64url encoded. */
  s?: string;
  seed?: number;
  mode?: Mode;
  /** Display time in milliseconds. */
  tMs?: number;
  /** Selected node; `null` means "none" (encoded as the literal `none`). */
  node?: number | null;
  tab?: Tab;
  speed?: number;
  lesson?: string;
  /** 0-based lesson step. The intro (-1) is encoded by omitting `step`. */
  step?: number;
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Parse `location.search` (with or without the leading `?`). Unknown or invalid values are dropped. */
export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: UrlState = {};
  const s = p.get('s');
  if (s) out.s = s;
  const scenario = p.get('scenario');
  if (scenario) out.scenario = scenario;
  const seed = num(p.get('seed'));
  if (seed !== undefined) out.seed = Math.floor(seed);
  const mode = p.get('mode');
  if (mode && (MODES as readonly string[]).includes(mode)) out.mode = mode as Mode;
  const t = num(p.get('t'));
  if (t !== undefined) out.tMs = t;
  const node = p.get('node');
  if (node === 'none') out.node = null;
  else {
    const n = num(node);
    if (n !== undefined) out.node = Math.floor(n);
  }
  const tab = p.get('tab');
  if (tab && (TABS as readonly string[]).includes(tab)) out.tab = tab as Tab;
  const speed = num(p.get('speed'));
  if (speed !== undefined && (SPEEDS as readonly number[]).includes(speed)) out.speed = speed;
  const lesson = p.get('lesson');
  if (lesson) out.lesson = lesson;
  const step = num(p.get('step'));
  if (step !== undefined) out.step = Math.floor(step);
  return out;
}

/** Format as a query string starting with `?`, or `''` when nothing is set. Key order is stable. */
export function formatUrlState(st: UrlState): string {
  const p = new URLSearchParams();
  if (st.s) p.set('s', st.s);
  else if (st.scenario) p.set('scenario', st.scenario);
  if (st.seed !== undefined) p.set('seed', String(st.seed));
  if (st.mode) p.set('mode', st.mode);
  if (st.tMs !== undefined) p.set('t', String(Math.round(st.tMs * 10) / 10));
  if (st.node !== undefined) p.set('node', st.node === null ? 'none' : String(st.node));
  if (st.tab) p.set('tab', st.tab);
  if (st.speed !== undefined) p.set('speed', String(st.speed));
  if (st.lesson) {
    p.set('lesson', st.lesson);
    if (st.step !== undefined && st.step >= 0) p.set('step', String(st.step));
  }
  const q = p.toString();
  return q ? `?${q}` : '';
}

// ---------------------------------------------------------------- compression

export const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** deflate-raw + base64url. Throws when the browser lacks CompressionStream (Safari < 16.4). */
export async function compressScenario(json: string): Promise<string> {
  if (!canCompress) throw new Error('CompressionStream is not available in this browser');
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(await collect(stream));
}

export async function decompressScenario(s: string): Promise<string> {
  if (!canCompress) throw new Error('DecompressionStream is not available in this browser');
  const stream = new Blob([fromBase64Url(s)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await collect(stream));
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

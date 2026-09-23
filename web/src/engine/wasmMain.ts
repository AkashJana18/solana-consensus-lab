// Small wasm helpers that run on the main thread (scenario list & validation).
// A second, tiny wasm instance is cheaper than round-tripping the worker for
// synchronous form validation.
import init, { builtinScenario, scenarioNames, validateScenario } from '../wasm/pkg/sim_wasm.js';
import wasmUrl from '../wasm/pkg/sim_wasm_bg.wasm?url';

let ready: Promise<void> | null = null;

export function ensureWasm(): Promise<void> {
  if (!ready) ready = init({ module_or_path: wasmUrl }).then(() => undefined);
  return ready;
}

export function listScenarios(): string[] {
  return JSON.parse(scenarioNames()) as string[];
}

export function loadScenario(name: string): string | undefined {
  return builtinScenario(name);
}

/** Returns null when valid, otherwise the engine's error message. */
export function validate(json: string): string | null {
  const r = validateScenario(json);
  return r === 'ok' ? null : r;
}

/** Override the scenario seed without touching anything else in the JSON. */
export function withSeed(json: string, seed: number): string {
  const obj = JSON.parse(json) as Record<string, unknown>;
  obj.seed = seed;
  return JSON.stringify(obj);
}

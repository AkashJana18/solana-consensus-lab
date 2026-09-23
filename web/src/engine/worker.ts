/// <reference lib="webworker" />
// Owns one `Sim` instance. The main thread never touches wasm directly.
import init, { Sim } from '../wasm/pkg/sim_wasm.js';
import wasmUrl from '../wasm/pkg/sim_wasm_bg.wasm?url';
import type { FromWorker, ToWorker } from './protocol';
import type { Inspect, Metrics, Protocol, SimMeta, Traced } from './types';

const ready = init({ module_or_path: wasmUrl });

let sim: Sim | null = null;
let protocol: Protocol = 'alpenglow';
let scenarioJson = '';

const post = (m: FromWorker) => self.postMessage(m);

function create(): Sim {
  if (sim) sim.free();
  sim = new Sim(protocol, scenarioJson);
  return sim;
}

function parseEvents(json: string): Traced[] {
  return JSON.parse(json) as Traced[];
}

function handle(msg: ToWorker): void {
  switch (msg.type) {
    case 'init': {
      protocol = msg.protocol;
      scenarioJson = msg.scenarioJson;
      const s = create();
      post({ type: 'meta', meta: JSON.parse(s.meta()) as SimMeta, end: s.end() });
      return;
    }
    case 'advance': {
      if (!sim) return;
      const events = parseEvents(sim.runUntil(msg.toMicros));
      post({ type: 'events', events, now: sim.now(), done: sim.isDone(), reset: false });
      return;
    }
    case 'step': {
      if (!sim) return;
      const events = parseEvents(sim.step());
      post({ type: 'events', events, now: sim.now(), done: sim.isDone(), reset: false });
      return;
    }
    case 'reset': {
      const s = create();
      const events = parseEvents(s.runUntil(msg.toMicros));
      post({ type: 'events', events, now: s.now(), done: s.isDone(), reset: true });
      return;
    }
    case 'inspect': {
      if (!sim) return;
      post({ type: 'inspect', node: msg.node, data: JSON.parse(sim.inspect(msg.node)) as Inspect });
      return;
    }
    case 'metrics': {
      if (!sim) return;
      post({ type: 'metrics', data: JSON.parse(sim.metrics()) as Metrics });
      return;
    }
  }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  try {
    await ready;
    handle(ev.data);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

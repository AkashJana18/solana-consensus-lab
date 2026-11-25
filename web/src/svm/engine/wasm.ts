import init, {
  svmLayout,
  svmPrograms,
  svmRun,
  svmVerify,
} from '../wasm/pkg/svm_wasm';
import type { Check, Layout, MappingMode, ProgramView, Run, Scenario } from './types';

let ready: Promise<void> | null = null;

export function ensureWasm(): Promise<void> {
  if (!ready) {
    ready = init().then(() => undefined);
  }
  return ready;
}

export async function runScenario(scenario: Scenario): Promise<Run> {
  await ensureWasm();
  return JSON.parse(svmRun(JSON.stringify(scenario))) as Run;
}

export async function verifyScenario(scenario: Scenario): Promise<Check[]> {
  await ensureWasm();
  return JSON.parse(svmVerify(JSON.stringify(scenario))) as Check[];
}

export async function loadLayout(mode: MappingMode): Promise<Layout> {
  await ensureWasm();
  return JSON.parse(svmLayout(mode)) as Layout;
}

export async function loadPrograms(): Promise<ProgramView[]> {
  await ensureWasm();
  return JSON.parse(svmPrograms()) as ProgramView[];
}

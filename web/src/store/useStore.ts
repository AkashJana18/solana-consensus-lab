import { create } from 'zustand';
import type { Protocol } from '../engine/types';
import { emptyView, type RunView } from './runView';

export type Mode = 'alpenglow' | 'tower' | 'compare';
export type Tab = 'transaction' | 'votor' | 'tower' | 'events' | 'metrics';

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 20] as const;

export function protocolsFor(mode: Mode): Protocol[] {
  return mode === 'compare' ? ['alpenglow', 'tower'] : [mode];
}

export interface LabState {
  scenarioNames: string[];
  scenarioName: string;
  scenarioJson: string;
  isCustom: boolean;
  mode: Mode;
  seed: number;
  playing: boolean;
  speed: number;
  displayTime: number;
  end: number;
  selectedNode: number | null;
  tab: Tab;
  customOpen: boolean;
  wasmReady: boolean;
  fatal: string | null;
  runs: Partial<Record<Protocol, RunView>>;

  set: (patch: Partial<LabState>) => void;
  setRun: (p: Protocol, view: RunView) => void;
  resetRuns: (protocols: Protocol[]) => void;
}

export const useStore = create<LabState>((set) => ({
  scenarioNames: [],
  scenarioName: 'happy-path',
  scenarioJson: '',
  isCustom: false,
  mode: 'alpenglow',
  seed: 1,
  playing: false,
  speed: 1,
  displayTime: 0,
  end: 0,
  selectedNode: 0,
  tab: 'transaction',
  customOpen: false,
  wasmReady: false,
  fatal: null,
  runs: {},

  set: (patch) => set(patch),
  setRun: (p, view) => set((s) => ({ runs: { ...s.runs, [p]: view } })),
  resetRuns: (protocols) => set({ runs: Object.fromEntries(protocols.map((p) => [p, emptyView(p)])) }),
}));

export const selectRun = (p: Protocol) => (s: LabState) => s.runs[p];
export const selectPrimaryProtocol = (s: LabState): Protocol => (s.mode === 'tower' ? 'tower' : 'alpenglow');

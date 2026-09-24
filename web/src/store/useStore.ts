import { create } from 'zustand';
import type { Protocol, Traced } from '../engine/types';
import { emptyView, type RunView } from './runView';

export type Mode = 'alpenglow' | 'tower' | 'compare';
export type Tab = 'transaction' | 'votor' | 'tower' | 'events' | 'metrics';

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 20] as const;

export function protocolsFor(mode: Mode): Protocol[] {
  return mode === 'compare' ? ['alpenglow', 'tower'] : [mode];
}

/** Per-step phase of a lesson: waiting for the prediction, running to the stop, or showing the explainer. */
export type LessonPhase = 'predict' | 'running' | 'reveal';

/** Progress through one lesson. `step` is -1 for the intro and `steps.length` for the outro. */
export interface LessonProgress {
  id: string;
  step: number;
  phase: LessonPhase;
  /** stepId -> chosen answer index */
  answers: Record<string, number>;
  /** stepId -> sim time (µs) at which the step's stop fired; deterministic, so reusable for Back */
  hits: Record<string, number>;
  /** stepId -> the trace event that fired the stop (null for time/deadline stops) */
  events: Record<string, Traced | null>;
  /** stepId -> true when the deadline passed without the trigger firing */
  missed: Record<string, true>;
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
  /** Non-fatal message shown above the canvas (e.g. a share link that could not be decoded). */
  notice: string | null;
  runs: Partial<Record<Protocol, RunView>>;

  lesson: LessonProgress | null;
  lessonsOpen: boolean;
  /** Set from the URL at boot; consumed once the first configure() resolves. */
  restoreTimeUs: number | null;
  restoreLesson: { id: string; step: number } | null;

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
  notice: null,
  runs: {},

  lesson: null,
  lessonsOpen: false,
  restoreTimeUs: null,
  restoreLesson: null,

  set: (patch) => set(patch),
  setRun: (p, view) => set((s) => ({ runs: { ...s.runs, [p]: view } })),
  resetRuns: (protocols) => set({ runs: Object.fromEntries(protocols.map((p) => [p, emptyView(p)])) }),
}));

export const selectRun = (p: Protocol) => (s: LabState) => s.runs[p];
export const selectPrimaryProtocol = (s: LabState): Protocol => (s.mode === 'tower' ? 'tower' : 'alpenglow');

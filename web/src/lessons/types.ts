// Lesson data model. Lessons are plain TypeScript objects so they are type-checked,
// unit-testable (see test/lessons.test.ts) and need no markdown toolchain.
import type { Trigger } from '../engine/breakpoint';
import type { Protocol, Traced } from '../engine/types';
import type { RunView } from '../store/runView';
import type { Mode, Tab } from '../store/useStore';

export interface Question {
  prompt: string;
  choices: string[];
  /** Index into `choices`. */
  answer: number;
  /** Shown after the run reaches the step, next to the learner's answer. Markdown-ish. */
  explain: string;
}

export interface LessonStep {
  id: string;
  title: string;
  /** Which run's events fire the stop (matters in compare mode). */
  protocol: Protocol;
  trigger: Trigger;
  /** Stop here anyway (µs) if the trigger never fires; the body then receives `hit = null`. */
  deadlineUs?: number;
  /** Shown before the stop is reached (what to watch for). Markdown-ish. */
  lead?: string;
  /** Explainer shown once the stop is reached. May read the hit event and the run view. Markdown-ish. */
  body: string | ((hit: Traced | null, view: RunView) => string);
  /** Predict-then-run question. Without one the step runs as soon as it is entered. */
  question?: Question;
  /** Node to select when the stop is reached: a fixed id, or the node named in the hit event. */
  selectNode?: number | 'hit';
  /** Inspector tab to open when the stop is reached. */
  tab?: Tab;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  /** Rough wall-clock duration for the picker. */
  minutes: number;
  /** Builtin scenario name (must exist in scenarios/). */
  scenario: string;
  mode: Mode;
  seed: number;
  /** Playback speed while running to each stop. */
  speed: number;
  intro: string;
  steps: LessonStep[];
  outro: string;
}

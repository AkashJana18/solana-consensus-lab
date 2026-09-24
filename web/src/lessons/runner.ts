// Drives a lesson: loads its scenario through the store (the same path the TopBar uses),
// arms one Controller breakpoint per step, and records where each stop landed.
import { controller } from '../engine/controller';
import type { Traced } from '../engine/types';
import { loadScenario } from '../engine/wasmMain';
import { useStore, type LabState, type LessonProgress } from '../store/useStore';
import { lessonById } from './index';
import type { LessonStep } from './types';

class LessonRunner {
  private unsubConfigured: (() => void) | null = null;

  /** Open a lesson at `step` (-1 = intro). Reconfigures the simulation if the lesson's scenario differs. */
  open(id: string, step = -1): void {
    const lesson = lessonById(id);
    if (!lesson) return;
    const json = loadScenario(lesson.scenario);
    const s = useStore.getState();
    if (!json) {
      s.set({ lessonsOpen: false, notice: `Lesson scenario "${lesson.scenario}" is not available in this build.` });
      return;
    }
    controller.pause();
    controller.setBreakpoint(null);
    this.unsubConfigured?.();
    this.unsubConfigured = null;

    const progress: LessonProgress = { id, step: -1, phase: 'reveal', answers: {}, hits: {}, events: {}, missed: {} };
    s.set({ lesson: progress, lessonsOpen: false, speed: lesson.speed, tab: 'transaction', selectedNode: 0 });

    const same = !s.isCustom && s.scenarioName === lesson.scenario && s.scenarioJson === json && s.mode === lesson.mode && s.seed === lesson.seed;
    if (same) {
      controller.seek(0);
      this.goTo(step);
      return;
    }
    this.unsubConfigured = controller.onConfigured(() => {
      this.unsubConfigured?.();
      this.unsubConfigured = null;
      if (useStore.getState().lesson?.id === id) this.goTo(step);
    });
    s.set({ scenarioName: lesson.scenario, scenarioJson: json, isCustom: false, mode: lesson.mode, seed: lesson.seed });
  }

  /** Move to step `i`. Revisited steps seek to their recorded stop; new steps arm a breakpoint. */
  goTo(i: number): void {
    const st = useStore.getState();
    const prog = st.lesson;
    if (!prog) return;
    const lesson = lessonById(prog.id);
    if (!lesson) return;
    const n = lesson.steps.length;
    i = Math.max(-1, Math.min(n, i));
    controller.pause();
    controller.setBreakpoint(null);

    if (i < 0 || i >= n) {
      st.set({ lesson: { ...prog, step: i, phase: 'reveal' } });
      return;
    }
    const step = lesson.steps[i];
    const hit = prog.hits[step.id];
    if (hit !== undefined) {
      controller.seek(hit);
      this.focus(step, prog.events[step.id] ?? null);
      st.set({ lesson: { ...prog, step: i, phase: 'reveal' } });
      controller.poll(true);
      return;
    }
    // Start scanning from the previous stop so a forward jump never misses the trigger.
    const prevHit = i > 0 ? prog.hits[lesson.steps[i - 1].id] : 0;
    if (prevHit !== undefined && controller.time > prevHit) controller.seek(prevHit);
    controller.setBreakpoint({ protocol: step.protocol, trigger: step.trigger, deadlineUs: step.deadlineUs }, (e, t) => this.onHit(i, e, t));
    st.set({ lesson: { ...prog, step: i, phase: step.question ? 'predict' : 'running' } });
    if (!step.question) controller.play();
  }

  /** Learner pressed Run after predicting. */
  run(): void {
    const st = useStore.getState();
    const prog = st.lesson;
    if (!prog || prog.phase !== 'predict') return;
    st.set({ lesson: { ...prog, phase: 'running' } });
    controller.play();
  }

  answer(choice: number): void {
    const st = useStore.getState();
    const prog = st.lesson;
    if (!prog) return;
    const lesson = lessonById(prog.id);
    const step = lesson?.steps[prog.step];
    if (!step) return;
    st.set({ lesson: { ...prog, answers: { ...prog.answers, [step.id]: choice } } });
  }

  next(): void {
    const prog = useStore.getState().lesson;
    if (prog) this.goTo(prog.step + 1);
  }

  back(): void {
    const prog = useStore.getState().lesson;
    if (prog) this.goTo(prog.step - 1);
  }

  /** Leave the lesson; the scenario stays loaded. */
  exit(): void {
    this.unsubConfigured?.();
    this.unsubConfigured = null;
    controller.setBreakpoint(null);
    useStore.getState().set({ lesson: null });
  }

  private onHit(i: number, e: Traced | null, t: number): void {
    const st = useStore.getState();
    const prog = st.lesson;
    if (!prog || prog.step !== i) return;
    const lesson = lessonById(prog.id);
    if (!lesson) return;
    const step = lesson.steps[i];
    const missed = e === null && step.trigger.type !== 'time' ? { ...prog.missed, [step.id]: true as const } : prog.missed;
    this.focus(step, e);
    st.set({
      lesson: {
        ...prog,
        phase: 'reveal',
        hits: { ...prog.hits, [step.id]: t },
        events: { ...prog.events, [step.id]: e },
        missed,
      },
    });
  }

  private focus(step: LessonStep, e: Traced | null): void {
    const patch: Partial<LabState> = {};
    if (step.selectNode === 'hit') {
      if (e && 'node' in e && typeof e.node === 'number') patch.selectedNode = e.node;
    } else if (typeof step.selectNode === 'number') patch.selectedNode = step.selectNode;
    if (step.tab) patch.tab = step.tab;
    if (Object.keys(patch).length) useStore.getState().set(patch);
  }
}

export const lessonRunner = new LessonRunner();

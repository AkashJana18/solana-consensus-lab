import { useEffect } from 'react';
import { controller } from './engine/controller';
import { ensureWasm, listScenarios, loadScenario, validate } from './engine/wasmMain';
import { CanvasView } from './render/CanvasView';
import { Inspector } from './components/Inspector';
import { LessonPanel } from './components/LessonPanel';
import { LessonPicker } from './components/LessonPicker';
import { ScenarioModal } from './components/ScenarioModal';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { lessonRunner } from './lessons/runner';
import { protocolsFor, useStore, type LabState } from './store/useStore';
import { decompressScenario, parseUrlState } from './url/state';

export function App() {
  const wasmReady = useStore((s) => s.wasmReady);
  const mode = useStore((s) => s.mode);
  const scenarioJson = useStore((s) => s.scenarioJson);
  const seed = useStore((s) => s.seed);
  const fatal = useStore((s) => s.fatal);
  const notice = useStore((s) => s.notice);
  const customOpen = useStore((s) => s.customOpen);
  const lessonsOpen = useStore((s) => s.lessonsOpen);
  const lessonActive = useStore((s) => s.lesson !== null);

  // Boot: load wasm, then hydrate the store from the URL (or defaults).
  useEffect(() => {
    const url = parseUrlState(location.search);
    void (async () => {
      await ensureWasm();
      const names = listScenarios();
      let scenarioName = names.includes('happy-path') ? 'happy-path' : names[0];
      let scenarioJson = loadScenario(scenarioName) ?? '';
      let isCustom = false;
      let notice: string | null = null;
      if (url.s) {
        try {
          const json = await decompressScenario(url.s);
          const err = validate(json);
          if (err) throw new Error(err);
          scenarioJson = json;
          isCustom = true;
          scenarioName = (JSON.parse(json) as { name?: string }).name ?? 'custom';
        } catch (e) {
          notice = `The scenario in this link could not be loaded (${e instanceof Error ? e.message : String(e)}); showing ${scenarioName} instead.`;
        }
      } else if (url.scenario) {
        if (names.includes(url.scenario)) {
          scenarioName = url.scenario;
          scenarioJson = loadScenario(url.scenario) ?? '';
        } else notice = `Unknown scenario "${url.scenario}" in this link; showing ${scenarioName} instead.`;
      }
      const patch: Partial<LabState> = {
        scenarioNames: names,
        scenarioName,
        scenarioJson,
        isCustom,
        notice,
        wasmReady: true,
        restoreTimeUs: url.tMs !== undefined && !url.lesson ? Math.round(url.tMs * 1000) : null,
        restoreLesson: url.lesson ? { id: url.lesson, step: url.step ?? -1 } : null,
      };
      if (url.seed !== undefined) patch.seed = url.seed;
      if (url.mode) patch.mode = url.mode;
      if (url.tab) patch.tab = url.tab;
      if (url.speed !== undefined) patch.speed = url.speed;
      if (url.node !== undefined) patch.selectedNode = url.node;
      useStore.getState().set(patch);
    })();
  }, []);

  // The single choke point: any change to mode / scenario / seed rebuilds the workers.
  useEffect(() => {
    if (!wasmReady || !scenarioJson) return;
    void controller.configure(mode, scenarioJson, seed).then(() => {
      const s = useStore.getState();
      if (s.restoreTimeUs !== null) {
        controller.seek(s.restoreTimeUs);
        controller.poll(true);
        s.set({ restoreTimeUs: null });
      }
      if (s.restoreLesson) {
        const r = s.restoreLesson;
        s.set({ restoreLesson: null });
        lessonRunner.open(r.id, r.step);
      }
    });
  }, [wasmReady, mode, scenarioJson, seed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        controller.toggle();
      } else if (e.key === '.') controller.stepEvent();
      else if (e.key === 'ArrowRight') controller.stepSlot();
      else if (e.key === 'ArrowLeft') {
        const slotUs = 400_000;
        controller.seek(controller.time - slotUs);
      } else if (e.key === 'Enter' && (!target || target.tagName === 'BODY')) {
        // Lesson shortcut: Enter runs the prediction or advances to the next step.
        const prog = useStore.getState().lesson;
        if (!prog) return;
        e.preventDefault();
        if (prog.phase === 'predict') lessonRunner.run();
        else if (prog.phase === 'reveal') lessonRunner.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const protocols = protocolsFor(mode);
  return (
    <div className="app">
      <TopBar />
      <main className={`main ${lessonActive ? 'lesson' : ''}`}>
        {lessonActive && <LessonPanel />}
        <section className={`canvases ${protocols.length > 1 ? 'compare' : ''}`} aria-label="Network animation">
          {fatal && (
            <div className="fatal" role="alert">
              <strong>Scenario failed to load</strong>
              <div>{fatal}</div>
            </div>
          )}
          {!fatal && notice && (
            <div className="fatal notice" role="status">
              <div>{notice}</div>
              <button onClick={() => useStore.getState().set({ notice: null })}>Dismiss</button>
            </div>
          )}
          {protocols.map((p) => (
            <CanvasView key={p} protocol={p} />
          ))}
        </section>
        <Inspector />
      </main>
      <Timeline />
      {customOpen && <ScenarioModal />}
      {lessonsOpen && <LessonPicker />}
    </div>
  );
}

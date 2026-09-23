import { useEffect } from 'react';
import { controller } from './engine/controller';
import { ensureWasm, listScenarios, loadScenario } from './engine/wasmMain';
import { CanvasView } from './render/CanvasView';
import { Inspector } from './components/Inspector';
import { ScenarioModal } from './components/ScenarioModal';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { protocolsFor, useStore } from './store/useStore';

export function App() {
  const wasmReady = useStore((s) => s.wasmReady);
  const mode = useStore((s) => s.mode);
  const scenarioJson = useStore((s) => s.scenarioJson);
  const seed = useStore((s) => s.seed);
  const fatal = useStore((s) => s.fatal);
  const customOpen = useStore((s) => s.customOpen);

  useEffect(() => {
    void ensureWasm().then(() => {
      const names = listScenarios();
      const first = names.includes('happy-path') ? 'happy-path' : names[0];
      useStore.getState().set({ scenarioNames: names, scenarioName: first, scenarioJson: loadScenario(first) ?? '', wasmReady: true });
    });
  }, []);

  useEffect(() => {
    if (!wasmReady || !scenarioJson) return;
    void controller.configure(mode, scenarioJson, seed);
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const protocols = protocolsFor(mode);
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <section className={`canvases ${protocols.length > 1 ? 'compare' : ''}`} aria-label="Network animation">
          {fatal && (
            <div className="fatal" role="alert">
              <strong>Scenario failed to load</strong>
              <div>{fatal}</div>
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
    </div>
  );
}

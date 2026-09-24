import { LESSONS } from '../lessons';
import { lessonRunner } from '../lessons/runner';
import { useStore } from '../store/useStore';
import { PROTOCOL_LABEL } from '../util/format';

/** Modal list of guided lessons. */
export function LessonPicker() {
  const set = useStore((s) => s.set);
  const close = () => set({ lessonsOpen: false });
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal lesson-picker" role="dialog" aria-modal="true" aria-labelledby="lessons-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="lessons-title">Guided lessons</h2>
        <p className="muted">
          Each lesson loads a scenario, pauses at the moments that matter and asks you to predict what happens next. Progress is kept while the
          lesson is open; links to a lesson step can be shared from the Share button.
        </p>
        <ul className="lesson-list">
          {LESSONS.map((l) => (
            <li key={l.id}>
              <button className="lesson-card" onClick={() => lessonRunner.open(l.id)} data-testid={`lesson-pick-${l.id}`}>
                <div className="lesson-card-title">{l.title}</div>
                <div className="lesson-card-summary">{l.summary}</div>
                <div className="lesson-card-meta muted">
                  {l.mode === 'compare' ? 'Compare' : PROTOCOL_LABEL[l.mode]} · {l.scenario} · ~{l.minutes} min · {l.steps.length} stops
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

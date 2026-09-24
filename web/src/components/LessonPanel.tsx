import { lessonById } from '../lessons';
import { lessonRunner } from '../lessons/runner';
import { useStore } from '../store/useStore';
import { fmtMs } from '../util/format';
import { Markdown } from './Markdown';

/** Left-column guide: intro → predict / run / reveal per step → outro. */
export function LessonPanel() {
  const prog = useStore((s) => s.lesson);
  const runs = useStore((s) => s.runs);
  if (!prog) return null;
  const lesson = lessonById(prog.id);
  if (!lesson) return null;

  const n = lesson.steps.length;
  const i = prog.step;
  const step = i >= 0 && i < n ? lesson.steps[i] : null;
  const phase = step ? prog.phase : 'reveal';
  const heading = i < 0 ? 'Introduction' : step ? step.title : 'Summary';
  const chosen = step ? prog.answers[step.id] : undefined;
  const hit = step ? prog.events[step.id] ?? null : null;
  const hitT = step ? prog.hits[step.id] : undefined;
  const view = step ? runs[step.protocol] : undefined;

  let body: string | null = null;
  if (i < 0) body = lesson.intro;
  else if (i >= n) body = lesson.outro;
  else if (step && phase === 'reveal') body = typeof step.body === 'function' ? (view ? step.body(hit, view) : '') : step.body;

  return (
    <aside className="lesson-panel" data-testid="lesson-panel" data-phase={phase} data-step={i} aria-label="Lesson">
      <header className="lesson-head">
        <div>
          <div className="lesson-kicker">Lesson · {i < 0 ? 'intro' : i >= n ? 'done' : `step ${i + 1} of ${n}`}</div>
          <div className="lesson-title" data-testid="lesson-title">
            {lesson.title}
          </div>
        </div>
        <button onClick={() => lessonRunner.exit()} title="Exit lesson" data-testid="lesson-exit">
          ✕
        </button>
      </header>

      <ol className="lesson-steps" aria-label="Steps">
        {lesson.steps.map((st, k) => {
          const state = k === i ? 'current' : prog.hits[st.id] !== undefined ? 'done' : 'todo';
          return (
            <li key={st.id} className={`lesson-dot ${state}`} data-testid={`lesson-step-${k}`} data-state={state} title={st.title}>
              <button onClick={() => lessonRunner.goTo(k)} aria-label={`Step ${k + 1}: ${st.title}`} disabled={state === 'todo' && k > i + 1} />
            </li>
          );
        })}
      </ol>

      <div className="lesson-body">
        <h2>{heading}</h2>

        {step && phase !== 'reveal' && step.lead && <Markdown source={step.lead} />}

        {step && step.question && phase !== 'reveal' && (
          <div className="lesson-question" data-testid="lesson-question">
            <p className="lesson-prompt">{step.question.prompt}</p>
            <div className="lesson-choices" role="radiogroup" aria-label="Your prediction">
              {step.question.choices.map((c, k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={chosen === k}
                  className={`lesson-choice ${chosen === k ? 'on' : ''}`}
                  onClick={() => lessonRunner.answer(k)}
                  disabled={phase === 'running'}
                  data-testid={`lesson-choice-${k}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {step && phase === 'running' && (
          <p className="muted lesson-running" data-testid="lesson-running">
            Running until: <b>{step.title}</b>…
          </p>
        )}

        {step && phase === 'reveal' && step.question && (
          <div className="lesson-answer" data-testid="lesson-answer" data-correct={chosen === step.question.answer ? 'true' : 'false'}>
            <div className="lesson-answer-line">
              <span className="muted">You predicted:</span> {chosen === undefined ? '—' : step.question.choices[chosen]}
            </div>
            <div className="lesson-answer-line">
              <span className="muted">What happened:</span> <b>{step.question.choices[step.question.answer]}</b>
            </div>
            <Markdown source={step.question.explain} className="small" />
          </div>
        )}

        {step && phase === 'reveal' && (
          <p className="muted small lesson-hit">
            {prog.missed[step.id] ? 'The trigger did not occur before the deadline at this seed; stopped at ' : 'Stopped at '}
            <b>{fmtMs(hitT)}</b>
            {hit && 'slot' in hit && hit.slot !== undefined ? ` · slot ${hit.slot}` : ''}
          </p>
        )}

        {body !== null && <Markdown source={body} />}
      </div>

      <footer className="lesson-actions">
        <button onClick={() => lessonRunner.back()} disabled={i <= -1} data-testid="lesson-back">
          ← Back
        </button>
        {step && phase === 'predict' && (
          <button className="primary" onClick={() => lessonRunner.run()} disabled={step.question !== undefined && chosen === undefined} data-testid="lesson-run" title="Enter">
            Run ▶
          </button>
        )}
        {step && phase === 'running' && (
          <button onClick={() => lessonRunner.goTo(i)} data-testid="lesson-restart" title="Rewind to the previous stop and re-arm">
            Restart step
          </button>
        )}
        {(phase === 'reveal' || !step) && i < n && (
          <button className="primary" onClick={() => lessonRunner.next()} data-testid="lesson-next" title="Enter">
            {i < 0 ? 'Start' : 'Next →'}
          </button>
        )}
        {i >= n && (
          <button className="primary" onClick={() => lessonRunner.exit()} data-testid="lesson-finish">
            Finish
          </button>
        )}
      </footer>
    </aside>
  );
}

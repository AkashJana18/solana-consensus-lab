import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { lessonById } from '../lessons';
import { lessonRunner } from '../lessons/runner';
import { useStore } from '../store/useStore';
import { fmtMs } from '../util/format';
import { clampPanel, parsePanelPos, type Point } from '../util/panelPos';
import { Markdown } from './Markdown';

/** Where the pane remembers its corner. One key, so every lesson opens in the same place. */
const POS_KEY = 'scl.lessonPanel';
/** Must match the 1023px rule that turns the pane into a sheet in styles/global.css. */
const NARROW = '(max-width: 1023px)';
/** Arrow-key step for a focused header, in px. Shift moves four times as far. */
const ARROW_STEP = 16;
/** Used to clamp before the pane has measured itself, and when CSS has collapsed it to 0. */
const NOMINAL = { width: 360, height: 480 };

const isNarrow = () => typeof matchMedia === 'function' && matchMedia(NARROW).matches;

function readPos(): Point | null {
  try {
    return parsePanelPos(localStorage.getItem(POS_KEY));
  } catch {
    // Private mode or disabled storage: no memory is better than a crash on open.
    return null;
  }
}

function savePos(pos: Point): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* the pane still works, it just will not remember */
  }
}

const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

/** Real size, with a nominal fallback for the frame before the pane is laid out. */
function paneSize(el: HTMLElement) {
  return { width: el.offsetWidth || NOMINAL.width, height: el.offsetHeight || NOMINAL.height };
}

/**
 * Where a lesson opens when nothing is remembered: over the top-left of the canvases, below
 * the protocol caption, so the first thing it covers is empty canvas rather than a label.
 */
function restingPos(el: HTMLElement): Point {
  const host = document.querySelector('.canvases')?.getBoundingClientRect();
  return clampPanel({ x: (host?.left ?? 0) + 12, y: (host?.top ?? 80) + 44 }, paneSize(el), viewportSize());
}

/**
 * Floating guide: intro → predict / run / reveal per step → outro.
 *
 * The pane used to be a 340px column in `.main`, which shrank both canvases for the whole
 * lesson. It is now fixed over the app instead, so the network keeps its full width and the
 * reader can park the copy wherever it is not covering the nodes being described. The shell
 * decides between a free pane (top/left) and a bottom sheet at the narrow breakpoint; both
 * keep a handle on the header, and the position survives a reload.
 */
export function LessonPanel() {
  const prog = useStore((s) => s.lesson);
  const runs = useStore((s) => s.runs);

  // Placement state is declared before the guards below so the hooks stay unconditional.
  const [saved] = useState(readPos);
  const [pos, setPos] = useState<Point | null>(() => (saved ? clampPanel(saved, NOMINAL, viewportSize()) : null));
  const [docked, setDocked] = useState(() => saved === null && isNarrow());
  const [dragging, setDragging] = useState(false);
  const pane = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number } | null>(null);

  // Place before the first paint: a pane corrected in a normal effect is one visible jump.
  // Runs once on purpose; every later move belongs to the reader.
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el || docked) return;
    setPos((p) => {
      const want = p ?? restingPos(el);
      const next = clampPanel(want, paneSize(el), viewportSize());
      return p && next.x === p.x && next.y === p.y ? p : next;
    });
  }, []);

  // Keep it reachable when the window changes: clamp a free pane, and pin a docked sheet
  // before the sheet rule disappears so it does not snap to x=0.
  useEffect(() => {
    const onResize = () => {
      const el = pane.current;
      if (!el) return;
      if (docked) {
        if (isNarrow()) return;
        const r = el.getBoundingClientRect();
        setDocked(false);
        setPos(clampPanel({ x: r.left, y: r.top }, NOMINAL, viewportSize()));
        return;
      }
      setPos((p) => (p ? clampPanel(p, paneSize(el), viewportSize()) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [docked]);

  const startDrag = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    // The close button is a control, not a handle.
    if ((e.target as HTMLElement).closest('button')) return;
    const el = pane.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    // A docked sheet is positioned by its bottom edge; pin the corner it is at right now so
    // the first move starts from there instead of jumping.
    setDocked(false);
    setPos({ x: r.left, y: r.top });
    setDragging(true);
  };

  const moveDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = pane.current;
    if (!d || !el || e.pointerId !== d.id) return;
    // At the sheet breakpoint the pane is still full width: only vertical movement counts.
    const dx = isNarrow() ? 0 : e.clientX - d.sx;
    const next = clampPanel({ x: d.x + dx, y: d.y + e.clientY - d.sy }, paneSize(el), viewportSize());
    // Track the clamped point, not the raw pointer: dragging past an edge and back then moves
    // the pane at once instead of leaving a dead zone the pointer has to re-cross.
    d.x = next.x;
    d.y = next.y;
    d.sx = e.clientX;
    d.sy = e.clientY;
    setPos(next);
  };

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    savePos({ x: d.x, y: d.y });
  };

  const nudge = (dx: number, dy: number) => {
    const el = pane.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const base = pos ?? { x: r.left, y: r.top };
    const next = clampPanel({ x: base.x + (isNarrow() ? 0 : dx), y: base.y + dy }, paneSize(el), viewportSize());
    setDocked(false);
    setPos(next);
    savePos(next);
  };

  const moveKeys = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? ARROW_STEP * 3 : ARROW_STEP;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    // The app scrubs the clock with the arrows on window; a focused handle owns them instead.
    e.stopPropagation();
    nudge(dx, dy);
  };

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

  const style = {
    '--panel-x': `${pos?.x ?? 12}px`,
    '--panel-y': `${pos?.y ?? 92}px`,
  } as CSSProperties;

  return (
    <aside
      ref={pane}
      className={`lesson-panel${docked ? ' bottom' : ''}`}
      style={style}
      data-testid="lesson-panel"
      data-phase={phase}
      data-step={i}
      data-dragging={dragging ? 'true' : undefined}
      aria-label="Lesson"
    >
      <header
        className="lesson-head"
        role="group"
        tabIndex={0}
        aria-label="Lesson panel. Drag, or use the arrow keys, to move it."
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={moveKeys}
      >
        <span className="lesson-grip" aria-hidden="true" data-tip="Drag to move" />
        <div className="lesson-head-text">
          <div className="lesson-kicker">Lesson · {i < 0 ? 'intro' : i >= n ? 'done' : `step ${i + 1} of ${n}`}</div>
          <div className="lesson-title" data-testid="lesson-title">
            {lesson.title}
          </div>
        </div>
        <button onClick={() => lessonRunner.exit()} data-tip="Exit lesson" data-testid="lesson-exit" aria-label="Exit lesson">
          ✕
        </button>
      </header>

      <ol className="lesson-steps" aria-label="Steps">
        {lesson.steps.map((st, k) => {
          const state = k === i ? 'current' : prog.hits[st.id] !== undefined ? 'done' : 'todo';
          return (
            <li key={st.id} className={`lesson-dot ${state}`} data-testid={`lesson-step-${k}`} data-state={state} data-tip={st.title}>
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
          <button className="primary" onClick={() => lessonRunner.run()} disabled={step.question !== undefined && chosen === undefined} data-testid="lesson-run" data-tip="Run (Enter)">
            Run ▶
          </button>
        )}
        {step && phase === 'running' && (
          <button onClick={() => lessonRunner.goTo(i)} data-testid="lesson-restart" data-tip="Rewind to the previous stop and re-arm">
            Restart step
          </button>
        )}
        {(phase === 'reveal' || !step) && i < n && (
          <button className="primary" onClick={() => lessonRunner.next()} data-testid="lesson-next" data-tip="Next step (Enter)">
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

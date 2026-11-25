import { useEffect, useMemo, useState } from 'react';
import { X86 } from '../content/lecture';
import {
  accountHexAt,
  changedRegisters,
  cuPercent,
  formatBytes,
  formatCu,
  formatHexBytes,
  shortAddress,
} from '../engine/model';
import { loadPrograms, runScenario } from '../engine/wasm';
import type { ProgramView, Run } from '../engine/types';
import { Badge, Bar, Panel, Segmented } from '../components/ui';

const LABELS: Record<string, string> = {
  counter: 'counter: read, add, write',
  'stack-frame': 'stack frame: a call and a return',
  'out-of-bounds': 'out of bounds: read past input',
  'heap-overflow': 'heap overflow: one byte past',
  recursion: 'recursion: verifier says no, run it anyway',
  'readonly-write': 'read-only account: write refused',
  'rodata-write': 'rodata: write refused',
  'bad-syscall': 'unknown syscall',
  'cu-exhausted': 'CU exhausted: loop forever',
};

const ENGINES = [
  { value: 'interpreter', label: 'Interpreter' },
  { value: 'jit', label: 'JIT' },
];

export function ChapterExecute() {
  const [programs, setPrograms] = useState<ProgramView[]>([]);
  const [selected, setSelected] = useState('counter');
  const [run, setRun] = useState<Run | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [engine, setEngine] = useState('interpreter');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadPrograms()
      .then((list) => {
        if (alive) setPrograms(list);
      })
      .catch((reason: unknown) => {
        if (alive) setError(String(reason));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setRun(null);
    setStep(0);
    setPlaying(false);
    setError(null);
    runScenario({ program: selected })
      .then((next) => {
        if (alive) setRun(next);
      })
      .catch((reason: unknown) => {
        if (alive) setError(String(reason));
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  useEffect(() => {
    if (!playing || !run) return;
    if (step >= run.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setStep((value) => value + 1), 480);
    return () => window.clearTimeout(id);
  }, [playing, step, run]);

  const current = run && run.steps.length > 0 ? run.steps[Math.min(step, run.steps.length - 1)] : null;
  const previous = run && step > 0 ? run.steps[step - 1] : null;
  const changed = useMemo(
    () => (current ? changedRegisters(previous, current) : new Set<number>()),
    [current, previous],
  );
  const hexes = run ? accountHexAt(run, step) : [];
  const logsSoFar = run
    ? run.steps
        .slice(0, step + 1)
        .flatMap((item) => (item.syscall?.log ? [item.syscall.log] : []))
    : [];
  const program = programs.find((item) => item.name === selected) ?? null;
  const touched = new Set(
    current?.accesses
      .map((access) => access.account)
      .filter((account): account is number => account !== null) ?? [],
  );
  const last = run ? Math.max(0, run.steps.length - 1) : 0;
  const atEnd = step >= last;
  const cu = current?.cu ?? 0;
  const cuTone = run ? (cuPercent(cu, run.cu_limit) > 90 ? 'bad' : cuPercent(cu, run.cu_limit) > 70 ? 'warn' : 'accent') : 'accent';

  function move(delta: number) {
    setPlaying(false);
    setStep((value) => Math.max(0, Math.min(last, value + delta)));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // The chapter container is focusable so arrows and Space work on the trace. A key
    // pressed inside a form control belongs to that control, not to the player.
    if ((event.target as HTMLElement).closest('input, select, textarea, button, a')) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === ' ') {
      event.preventDefault();
      setPlaying((value) => !value);
    }
  }

  return (
    <div className="svm-chapter" onKeyDown={onKeyDown} tabIndex={0}>
      <section className="svm-hero">
        <p className="svm-eyebrow">03 · Program execution</p>
        <h1>The address space is huge. CU is the wall.</h1>
        <p className="svm-lede">
          A transaction enters the runtime, the loader finds the executable, verifies it,
          and hands control to the sBPF VM. From there it is registers, five memory
          regions, and a meter that can end the transaction at any instruction.
        </p>
      </section>

      <div className="ex-toolbar">
        <label className="ex-select">
          Program
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {programs.map((item) => (
              <option key={item.name} value={item.name}>
                {LABELS[item.name] ?? item.name}
              </option>
            ))}
          </select>
        </label>

        <div className="ex-transport" role="group" aria-label="Trace controls">
          <button type="button" onClick={() => { setPlaying(false); setStep(0); }}>Start</button>
          <button type="button" onClick={() => move(-1)} aria-label="Previous step">←</button>
          <button type="button" className="primary" onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Next step">→</button>
          <button type="button" onClick={() => { setPlaying(false); setStep(last); }}>End</button>
          <span className="svm-mono">{Math.min(step + 1, last + 1)} / {run?.steps.length ?? 0}</span>
          {run && run.steps_total > run.steps.length ? (
            <Badge tone="warn">showing {run.steps.length} of {run.steps_total} steps</Badge>
          ) : null}
        </div>

        <Segmented
          value={engine}
          options={ENGINES}
          onChange={setEngine}
          label="Execution engine"
        />
      </div>

      {error ? <p className="svm-error">{error}</p> : null}

      {run ? (
        <div className={`ex-result ${atEnd ? (run.result.ok ? 'good' : 'bad') : ''}`}>
          <b>{atEnd ? (run.result.ok ? 'Committed' : run.result.code) : 'Running'}</b>
          <span>{atEnd ? run.result.message : `step ${step + 1} of ${run.steps.length}`}</span>
          <span className="svm-mono">{cu} / {run.cu_limit} CU</span>
        </div>
      ) : (
        <p className="svm-loading">loading the trace…</p>
      )}

      {current?.syscall ? (
        <div className="ex-gate">
          <span className="ex-gate-label">isolation boundary</span>
          <b>{current.syscall.name}</b>
          <p>{current.syscall.note}</p>
          <code>{current.syscall.log}</code>
        </div>
      ) : null}

      <div className="ex-grid">
        <div className="ex-col">
          <Panel title="Instructions" kicker={program?.summary ?? 'the program being traced'}>
            <ol className="ex-insns">
              {program?.insns.map((insn) => (
                <li key={insn.index} className={current?.insn === insn.index ? 'on' : ''}>
                  <span className="ex-insn-index">{insn.index}</span>
                  <div>
                    <b>{insn.mnemonic}</b>
                    <code>{insn.text}</code>
                    <small>{insn.label}</small>
                  </div>
                  <span className="ex-insn-cost">{insn.cost} CU</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="ex-col">
          <Panel title="Memory" kicker="Five regions. The hot one is being touched by this step.">
            <div className="ex-regions">
              {run?.regions.map((region) => {
                const accesses = current?.accesses.filter((access) => access.region === region.region) ?? [];
                return (
                  <div key={region.region} className={`ex-region ${accesses.length ? 'hot' : ''}`}>
                    <div className="ex-region-head">
                      <b>{region.region}</b>
                      <span className="svm-mono">{shortAddress(region.base)}</span>
                      <span>{formatBytes(region.used)} / {formatBytes(region.size)}</span>
                      <Badge tone={region.writable ? 'warn' : 'muted'}>{region.writable ? 'rw' : 'ro'}</Badge>
                    </div>
                    <p>{region.description}</p>
                    {accesses.length ? (
                      <div className="ex-access">
                        {accesses.map((access, index) => (
                          <span key={index} className={access.kind}>
                            {access.kind} {access.len} B @ +{access.offset}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Accounts" kicker="The input region, account by account. Writes appear as you step.">
            <div className="ex-accounts">
              {run?.slots.map((slot) => {
                const attempted = hexes[slot.index] ?? '';
                const before = run.accounts_before[slot.index]?.data_hex ?? '';
                const rolledBack = atEnd && !run.result.ok && attempted !== before;
                const shown = rolledBack ? before : attempted;
                return (
                  <div key={slot.index} className={`ex-account ${touched.has(slot.index) ? 'hot' : ''}`}>
                    <header>
                      <b>{slot.name}</b>
                      {slot.writable ? <Badge tone="warn">writable</Badge> : <Badge>read only</Badge>}
                      {slot.executable ? <Badge tone="accent">executable</Badge> : null}
                    </header>
                    <p className="svm-mono">
                      {slot.owner.slice(0, 10)}… · {formatCu(slot.lamports)} lamports · offset {slot.offset}
                    </p>
                    {shown ? <code>{formatHexBytes(shown)}</code> : <span className="svm-small">no data</span>}
                    {attempted !== before ? (
                      <small className={`ex-diff ${atEnd && !run.result.ok ? 'bad' : ''}`}>
                        {atEnd
                          ? run.result.ok
                            ? 'committed change'
                            : 'rolled back'
                          : 'written in this trace'}
                      </small>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        <div className="ex-col">
          <Panel title="Registers" kicker="Changed values are lit.">
            <div className="ex-regs">
              {current?.regs.map((value, index) => (
                <div key={index} className={`ex-reg ${changed.has(index) ? 'changed' : ''} ${index === 10 ? 'fp' : ''}`}>
                  <span>r{index}{index === 10 ? ' fp' : ''}</span>
                  <b>{value.toString(16)}</b>
                </div>
              ))}
            </div>
            {current?.note ? <p className="ex-note">{current.note}</p> : null}
          </Panel>

          <Panel title="Compute" kicker="The economic wall.">
            <div className="ex-cu">
              <div className="row-between">
                <span>used</span>
                <b>{formatCu(cu)} / {formatCu(run?.cu_limit ?? 0)}</b>
              </div>
              <Bar pct={cuPercent(cu, run?.cu_limit ?? 0)} tone={cuTone} />
              <p className="svm-small">
                This step costs {current?.cost ?? 0} CU. The trace records the charge even
                when the instruction faults.
              </p>
            </div>
            <div className="ex-logs">
              <h4>Logs</h4>
              {logsSoFar.length ? (
                logsSoFar.slice(-5).map((log, index) => (
                  <code key={index}>{log}</code>
                ))
              ) : (
                <p className="svm-small">no syscalls yet</p>
              )}
            </div>
          </Panel>

          <Panel
            title="Engine"
            kicker={engine === 'interpreter' ? 'one instruction at a time' : 'compiled once, invoked once'}
          >
            {current ? (
              <>
                <div className="ex-engine">
                  <div>
                    <small>{engine === 'interpreter' ? 'sBPF' : 'x86_64'}</small>
                    <code>
                      {engine === 'interpreter'
                        ? current.text
                        : X86[current.mnemonic] ?? 'no translation in the model'}
                    </code>
                  </div>
                  <Badge tone={engine === 'interpreter' ? 'muted' : 'accent'}>
                    {engine === 'interpreter' ? 'step' : 'block'}
                  </Badge>
                </div>
                <p className="svm-small">
                  {engine === 'interpreter'
                    ? 'The interpreter decodes each instruction and executes it natively as it is encountered.'
                    : 'The JIT translates the whole program, seals the pages, then calls one native entrypoint. The x86 shown here is an annotated translation, not a real compiler.'}
                </p>
              </>
            ) : null}
          </Panel>
        </div>
      </div>

      {atEnd && run ? (
        <Panel
          title={run.result.ok ? 'State commit' : 'Rollback'}
          kicker={run.result.ok ? 'Writable accounts are copied back to the Bank.' : 'Every write in this trace is discarded.'}
        >
          <div className={`ex-commit ${run.result.ok ? 'good' : 'bad'}`}>
            <p>
              {run.result.ok
                ? 'The input copy is the source of truth at the end of a successful invocation. Locks release, the Bank records the result, and the next transaction sees the new bytes.'
                : 'The loader received an error. The runtime releases the locks and restores every account, so the failed invocation leaves no trace in state.'}
            </p>
            {run.accounts_before.map((before, index) => {
              const after = run.accounts_after[index];
              if (!after || before.data_hex === after.data_hex) return null;
              return (
                <div key={before.index} className="ex-diffrow">
                  <b>{before.name}</b>
                  <code>{formatHexBytes(before.data_hex)}</code>
                  <span aria-hidden="true">→</span>
                  <code>{formatHexBytes(after.data_hex)}</code>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

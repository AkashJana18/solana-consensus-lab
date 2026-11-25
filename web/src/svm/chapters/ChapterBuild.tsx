import { useEffect, useMemo, useState } from 'react';
import { FORBIDDEN, PIPELINE } from '../content/lecture';
import { deployPlan, formatCu } from '../engine/model';
import { verifyScenario } from '../engine/wasm';
import type { Check } from '../engine/types';
import { Badge, Bar, Panel } from '../components/ui';

const ELF_BYTES = 24_832;
const CHUNK_MIN = 256;
const CHUNK_MAX = 4_096;

const FAULTS: { id: string | null; label: string }[] = [
  { id: null, label: 'Clean build' },
  { id: 'empty', label: 'Empty program' },
  { id: 'opcode', label: 'Bad opcode' },
  { id: 'register', label: 'r12' },
  { id: 'r10', label: 'Write r10' },
  { id: 'jump', label: 'Bad call' },
  { id: 'syscall', label: 'Unknown syscall' },
];

export function ChapterBuild() {
  const [stage, setStage] = useState(0);
  const [stock, setStock] = useState(false);
  const [chunk, setChunk] = useState(1_024);
  const [progress, setProgress] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [fault, setFault] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [openForbidden, setOpenForbidden] = useState<string | null>('io');

  const current = PIPELINE[stage];
  const plan = useMemo(() => deployPlan(ELF_BYTES, chunk), [chunk]);
  const deployed = progress >= plan.chunks;
  const stockBlocked = stock && (current.id === 'sbpf' || current.id === 'elf');

  useEffect(() => {
    let alive = true;
    setChecking(true);
    verifyScenario({ program: 'counter', fault })
      .then((next) => {
        if (alive) {
          setChecks(next);
          setChecking(false);
        }
      })
      .catch(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [fault]);

  useEffect(() => {
    if (!deploying) return;
    if (progress >= plan.chunks) {
      setDeploying(false);
      return;
    }
    const delay = Math.max(35, Math.min(140, 2_500 / plan.chunks));
    const id = window.setTimeout(() => setProgress((value) => value + 1), delay);
    return () => window.clearTimeout(id);
  }, [deploying, progress, plan.chunks]);

  function startDeploy() {
    setProgress(0);
    setDeploying(true);
  }

  return (
    <div className="svm-chapter">
      <section className="svm-hero">
        <p className="svm-eyebrow">02 · Compilation and deployment</p>
        <h1>The fork exists to hit a target.</h1>
        <p className="svm-lede">
          A contract is ordinary Rust compiled by a Solana fork of rustc and LLVM. The
          output is a position-independent ELF of sBPF bytecode, deployed into an
          executable account in chunks, then verified once and cached.
        </p>
      </section>

      <Panel
        title="The pipeline"
        kicker="Same front end, different target. Toggle the toolchain to see where they diverge."
        right={
          <button
            type="button"
            className={stock ? 'on' : ''}
            aria-pressed={stock}
            onClick={() => setStock((value) => !value)}
          >
            {stock ? 'Stock Rust' : 'Solana fork'}
          </button>
        }
      >
        <div className="pipe-tabs" role="tablist" aria-label="Compilation stages">
          {PIPELINE.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === stage}
              className={index === stage ? 'on' : ''}
              onClick={() => setStage(index)}
            >
              <span>{index + 1}</span>
              {item.title}
            </button>
          ))}
        </div>

        <div className="pipe-body">
          <div className="pipe-code">
            {stockBlocked ? (
              <p className="pipe-blocked">
                Not reachable with stock Rust. The compiler has no sBPF target, so there
                is no ELF to deploy.
              </p>
            ) : (
              <pre>
                <code>
                  {stock && current.id === 'llvm'
                    ? `define i64 @process(ptr %ctx) {
  ; target triple = "x86_64-unknown-linux-gnu"
  ; this is a validator binary, not a contract
}`
                    : current.code}
                </code>
              </pre>
            )}
          </div>
          <div className="pipe-note">
            <p className="svm-eyebrow">{current.kicker}</p>
            <h3>{current.title}</h3>
            <p>{current.note}</p>
            <p className="pipe-changed">
              <span>What changed</span>
              {stock && current.id === 'llvm'
                ? 'nothing: stock LLVM still emits x86 or ARM'
                : current.changed}
            </p>
          </div>
        </div>
      </Panel>

      <div className="build-grid">
        <Panel title="Deploy console" kicker="Create the account, size it, write the ELF in chunks, deploy.">
          <div className="deploy-head">
            <div>
              <small>Program account</small>
              <b className="svm-mono">Counter111…1111</b>
            </div>
            <Badge tone="warn">owned by BPFLoaderUpgradeab1e…</Badge>
          </div>

          <div className="deploy-size">
            <div>
              <small>ELF size</small>
              <b>{ELF_BYTES.toLocaleString('en-US')} B</b>
            </div>
            <div>
              <small>Rent-exempt</small>
              <b>2 years</b>
            </div>
            <div>
              <small>Finalize</small>
              <b>immutable</b>
            </div>
          </div>

          <label className="deploy-chunk">
            Chunk size
            <input
              type="range"
              min={CHUNK_MIN}
              max={CHUNK_MAX}
              step={128}
              value={chunk}
              onChange={(event) => {
                setChunk(Number(event.target.value));
                setProgress(0);
              }}
            />
            <span className="svm-mono">{chunk} B</span>
          </label>

          <div className="deploy-stats">
            <div>
              <small>Writes</small>
              <b>{plan.chunks}</b>
            </div>
            <div>
              <small>Transactions</small>
              <b>{plan.txs}</b>
            </div>
            <div>
              <small>CU per write</small>
              <b>{formatCu(plan.cuPerWrite)}</b>
            </div>
            <div>
              <small>Total CU</small>
              <b>{formatCu(plan.cuTotal)}</b>
            </div>
          </div>

          <Bar pct={(progress / plan.chunks) * 100} tone={deployed ? 'good' : 'accent'} />
          <div className="deploy-chunks" aria-hidden="true">
            {Array.from({ length: plan.chunks }, (_, index) => (
              <i key={index} className={index < progress ? 'on' : ''} />
            ))}
          </div>
          <div className="deploy-progress">
            <span>
              {deployed
                ? 'deployed, verified, executable'
                : `${progress} of ${plan.chunks} chunks written`}
            </span>
            <button type="button" className="primary" onClick={startDeploy} disabled={deploying}>
              {deploying ? 'Writing…' : deployed ? 'Deploy again' : 'Deploy'}
            </button>
          </div>
          <p className="svm-small">
            CU here is illustrative: the model charges per chunk so the tradeoff is visible.
            Smaller chunks mean more transactions, larger chunks mean fewer writes.
          </p>
        </Panel>

        <Panel
          title="Verification"
          kicker="Inject one fault. Exactly one check should fail."
          right={checking ? <Badge>checking</Badge> : <Badge tone="good">{checks.filter((c) => c.ok).length}/{checks.length} pass</Badge>}
        >
          <div className="fault-tabs" role="group" aria-label="Fault injection">
            {FAULTS.map((item) => (
              <button
                key={item.label}
                type="button"
                className={fault === item.id ? 'on' : ''}
                onClick={() => setFault(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <ul className="check-list">
            {checks.map((check) => (
              <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
                <span className="check-mark" aria-hidden="true">{check.ok ? '✓' : '×'}</span>
                <div>
                  <b>{check.label}</b>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="svm-small">
            Recursion and an unknown syscall are the two builtins that fail on purpose.
            The runtime frame limit is the backstop, not the first line of defence.
          </p>
        </Panel>
      </div>

      <Panel
        title="What the sandbox forbids"
        kicker="Each restriction exists for determinism, isolation, or both. Click one."
      >
        <div className="forbid-grid">
          {FORBIDDEN.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`forbid-card ${openForbidden === item.id ? 'on' : ''}`}
              onClick={() => setOpenForbidden(openForbidden === item.id ? null : item.id)}
            >
              <b>{item.title}</b>
              <span>{item.body}</span>
              {openForbidden === item.id ? <em>{item.mechanism}</em> : null}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

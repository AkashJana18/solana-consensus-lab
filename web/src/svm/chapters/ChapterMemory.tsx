import { useEffect, useState } from 'react';
import {
  LOCK_TXS,
  MAPPING_NOTE,
  PROVENANCE_LABEL,
} from '../content/lecture';
import { loadLayout } from '../engine/wasm';
import {
  formatBytes,
  hostAddress,
  laneConflicts,
  shortAddress,
} from '../engine/model';
import type { Layout, MappingMode, RegionName } from '../engine/types';
import { Badge, Panel, Segmented } from '../components/ui';

const MODES: { value: MappingMode; label: string }[] = [
  { value: 'identity', label: 'Identity' },
  { value: 'aligned', label: 'Aligned' },
  { value: 'unaligned', label: 'Unaligned' },
];

const BACKING: Record<RegionName, string> = {
  text: 'ELF .text segment',
  rodata: 'ELF .rodata segment',
  stack: 'VmMemoryPool stack Vec',
  heap: 'VmMemoryPool heap Vec',
  input: 'serialized accounts',
};

export function ChapterMemory() {
  const [mode, setMode] = useState<MappingMode>('aligned');
  const [layout, setLayout] = useState<Layout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RegionName>('stack');
  const [offset, setOffset] = useState(16);
  const [xray, setXray] = useState(false);
  const [laneB, setLaneB] = useState<string[]>(['C']);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadLayout(mode)
      .then((next) => {
        if (alive) setLayout(next);
      })
      .catch((reason: unknown) => {
        if (alive) setError(String(reason));
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  const region = layout?.regions.find((item) => item.region === selected) ?? null;
  const translated = region ? hostAddress(region, offset, mode) : null;
  const laneA = LOCK_TXS.filter((tx) => !laneB.includes(tx.id));
  const laneBTxs = LOCK_TXS.filter((tx) => laneB.includes(tx.id));
  const collisions = laneConflicts(laneA, laneBTxs);

  function toggleLane(id: string) {
    setLaneB((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div className="svm-chapter">
      <section className="svm-hero">
        <p className="svm-eyebrow">01 · Validators and memory</p>
        <h1>There is no blockchain in memory.</h1>
        <p className="svm-lede">
          A validator is a long-running Rust process. The Bank, the AccountsDB and the
          program code are just data inside it. The sBPF VM does not allocate a separate
          machine: it builds a five-region window over memory the validator already owns.
        </p>
        <p className="svm-quote">
          &ldquo;There is no abstract blockchain in the validator&rsquo;s memory, only structured
          data, algorithms, and network protocols.&rdquo;
        </p>
      </section>

      <Panel
        title="Two address spaces, one set of bytes"
        kicker="Pick a region, move the probe, change the mapping mode."
        right={
          <Segmented
            value={mode}
            options={MODES}
            onChange={(value) => setMode(value as MappingMode)}
            label="Mapping mode"
          />
        }
      >
        <div className={`mem-grid ${xray ? 'xray' : ''}`}>
          <div className="mem-host">
            <h3>Validator process (host)</h3>
            <div className="mem-host-row">
              <b>Bank</b>
              <span>candidate block, rolled back on failure</span>
            </div>
            <div className="mem-host-row">
              <b>AccountsDB</b>
              <span>accounts, program data, cached executables</span>
            </div>
            <div className="mem-host-row">
              <b>SVM</b>
              <span>loader, verifier, one VM instance per invocation</span>
            </div>
            <div className="mem-host-row highlight">
              <b>VmMemoryPool</b>
              <span>stack Vec&lt;u8&gt; + heap Vec&lt;u8&gt;</span>
            </div>
            <p className="mem-host-note">
              The host address is real memory in the validator. The VM address is a
              convention the program believes in.
            </p>
          </div>

          <div className="mem-arrow" aria-hidden="true">
            <span>maps to</span>
            <i />
            <b>{BACKING[selected]}</b>
          </div>

          <div className="mem-vm">
            <h3>sBPF VM address space</h3>
            {layout ? (
              layout.regions.map((item) => (
                <button
                  key={item.region}
                  type="button"
                  className={`mem-region ${item.region === selected ? 'on' : ''}`}
                  onClick={() => setSelected(item.region)}
                >
                  <span className="mem-region-name">{item.region}</span>
                  <span className="mem-region-base">{shortAddress(item.base)}</span>
                  <span className="mem-region-used">
                    {formatBytes(item.used)} / {formatBytes(item.size)}
                  </span>
                  {item.writable ? <Badge tone="warn">rw</Badge> : <Badge>ro</Badge>}
                </button>
              ))
            ) : (
              <p className="svm-loading">loading the layout…</p>
            )}
            <p className="mem-vm-note">
              Five 4 GiB slices. From inside a program, only this side exists.
            </p>
          </div>
        </div>

        <div className="mem-translate">
          <div className="mem-translate-controls">
            <label>
              Probe offset
              <input
                type="range"
                min={0}
                max={512}
                step={1}
                value={offset}
                onChange={(event) => setOffset(Number(event.target.value))}
              />
            </label>
            <span className="svm-mono">{offset} = {shortAddress(offset)}</span>
            <div className="mem-nudge">
              <button type="button" onClick={() => setOffset((value) => Math.max(0, value - 1))}>-1</button>
              <button type="button" onClick={() => setOffset((value) => value + 1)}>+1</button>
              <button type="button" onClick={() => setOffset((value) => value + 3)}>+3</button>
            </div>
            <button
              type="button"
              className={xray ? 'on' : ''}
              aria-pressed={xray}
              onClick={() => setXray((value) => !value)}
            >
              X-ray
            </button>
          </div>

          {region && translated ? (
            <div className={`mem-result ${translated.ok ? '' : 'bad'}`}>
              <div>
                <small>VM address</small>
                <b className="svm-mono">{shortAddress(region.base + offset)}</b>
              </div>
              <span className="mem-result-arrow" aria-hidden="true">→</span>
              <div>
                <small>Host address</small>
                <b className="svm-mono">
                  {translated.ok ? shortAddress(translated.address) : 'refused'}
                </b>
              </div>
              <p>
                {translated.ok
                  ? MAPPING_NOTE[mode]
                  : translated.reason}
              </p>
            </div>
          ) : null}
          {error ? <p className="svm-error">{error}</p> : null}
        </div>

        <p className="mem-hint">
          Under <b>Aligned</b>, press +3. The access is refused because the host address
          would not preserve the VM alignment. Switch to <b>Unaligned</b> to see the
          future implementation let it through.
        </p>
      </Panel>

      <Panel
        title="Aliasing XOR mutability"
        kicker="Move transactions between the lanes. A conflict means they cannot run at the same time."
      >
        <div className="lock-grid">
          <div className="lock-lane">
            <header>
              <b>Lane 1</b>
              <span>{laneA.length} {laneA.length === 1 ? 'transaction' : 'transactions'}</span>
            </header>
            {laneA.map((tx) => (
              <button key={tx.id} type="button" className="lock-tx" onClick={() => toggleLane(tx.id)}>
                <b>{tx.id}</b>
                <span>{tx.label}</span>
                <small>
                  {tx.reads.length ? `reads ${tx.reads.join(', ')}` : 'no reads'}
                  {tx.writes.length ? ` · writes ${tx.writes.join(', ')}` : ' · read only'}
                </small>
              </button>
            ))}
          </div>

          <div className="lock-lane">
            <header>
              <b>Lane 2</b>
              <span>{laneBTxs.length} {laneBTxs.length === 1 ? 'transaction' : 'transactions'}</span>
            </header>
            {laneBTxs.length === 0 ? (
              <p className="lock-empty">Click a transaction in lane 1 to move it here.</p>
            ) : (
              laneBTxs.map((tx) => (
                <button key={tx.id} type="button" className="lock-tx" onClick={() => toggleLane(tx.id)}>
                  <b>{tx.id}</b>
                  <span>{tx.label}</span>
                  <small>
                    {tx.reads.length ? `reads ${tx.reads.join(', ')}` : 'no reads'}
                    {tx.writes.length ? ` · writes ${tx.writes.join(', ')}` : ' · read only'}
                  </small>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={`lock-verdict ${collisions.length ? 'bad' : 'good'}`}>
          {collisions.length === 0 ? (
            <p>No account is written by one lane and touched by the other. Both lanes can run in parallel.</p>
          ) : (
            <p>
              {collisions.length} conflict{collisions.length === 1 ? '' : 's'}:{' '}
              {collisions.map((hit) => `${hit.a} and ${hit.b} both need ${hit.accounts.join(', ')}`).join('; ')}.
              One lane has to wait.
            </p>
          )}
          <p className="svm-small">
            This is the runtime version of Rust&rsquo;s rule: many readers, or one writer, never both.
          </p>
        </div>
      </Panel>

      <Panel title="Every number has a source" kicker="The lecture flags some limits as fuzzy. The lab shows which is which.">
        <div className="const-grid">
          {layout?.constants.map((constant) => (
            <div key={constant.name} className="const-card">
              <div className="const-head">
                <b>{constant.name}</b>
                <Badge
                  tone={
                    constant.provenance === 'source'
                      ? 'good'
                      : constant.provenance === 'docs'
                        ? 'warn'
                        : 'muted'
                  }
                >
                  {PROVENANCE_LABEL[constant.provenance]}
                </Badge>
              </div>
              <span className="const-value">{constant.value}</span>
              <p>{constant.note}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

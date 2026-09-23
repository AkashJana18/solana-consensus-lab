import { useState } from 'react';
import { validate } from '../engine/wasmMain';
import { useStore } from '../store/useStore';

/** Paste-a-scenario dialog. Validation is done by the engine itself (`validateScenario`). */
export function ScenarioModal() {
  const s = useStore();
  const [text, setText] = useState(() => (s.isCustom ? s.scenarioJson : pretty(s.scenarioJson)));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const err = validate(text);
    if (err) {
      setError(err);
      return;
    }
    let name = 'custom';
    try {
      name = (JSON.parse(text) as { name?: string }).name ?? name;
    } catch {
      /* validated above */
    }
    s.set({ scenarioJson: text, scenarioName: name, isCustom: true, customOpen: false });
  };

  return (
    <div className="modal-backdrop" onClick={() => s.set({ customOpen: false })}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="custom-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="custom-title">Custom scenario JSON</h2>
        <p className="muted">
          Same schema as <code>scenarios/*.json</code>: <code>name</code>, <code>duration_ms</code>, <code>validators</code>, <code>faults</code>
          (offline / partition / delay / drop), <code>hero_tx</code>, <code>params</code>. The seed field is overridden by the seed input.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          rows={18}
        />
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={() => s.set({ customOpen: false })}>Cancel</button>
          <button className="primary" onClick={apply}>
            Validate &amp; load
          </button>
        </div>
      </div>
    </div>
  );
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

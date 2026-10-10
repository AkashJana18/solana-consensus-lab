import { useEffect, useState } from 'react';
import { controller } from '../engine/controller';
import { useStore } from '../store/useStore';
import { PROTOCOL_LABEL } from '../util/format';

/**
 * Capture panel for a live devnet run.
 *
 * Polling starts when the button is pressed, never on load. A shared `?mode=live` link
 * renders this panel with a signature in it and nothing running, because the alternative is
 * a visitor who clicked nothing spending a third party's request budget: the public devnet
 * endpoint is free tier and rate limited to 150 requests per 10s per IP, and one live tab
 * costs roughly a third of that. Consent to observe a cluster should be a click.
 *
 * What the trace can honestly show is written on the panel, because the limit is the whole
 * point: the commitment levels and the skipped slots are devnet's own, and the votes and
 * certificates in the other two modes are not, because Alpenglow keeps them off-chain.
 */
export function LivePanel() {
  const run = useStore((s) => s.runs.live);
  const [signature, setSignature] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const watched = run?.txStages.submitted?.detail ?? null;
  const running = controller.liveRunning;

  // The store starts with no signature, so show the one already being traced after a reload
  // of the panel rather than pretending nothing is watched. This only fills the field; it
  // does not start polling, which is the panel's button to press.
  useEffect(() => {
    if (watched && signature === '') setSignature(watched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);

  const start = () => {
    const trimmed = signature.trim();
    if (!trimmed) {
      setMessage('Paste a devnet signature first, then press Start.');
      return;
    }
    setMessage(null);
    if (controller.watchLive(trimmed)) setSignature(trimmed);
    else setMessage('Live mode is not the one currently configured.');
  };

  const stop = () => {
    controller.stopLive();
    setMessage('Stopped. Nothing is being polled.');
  };

  const commitment = run?.commitment;

  return (
    <section className="live-panel" aria-label="Live devnet trace">
      <h2>{PROTOCOL_LABEL.live}, observed</h2>
      <p className="muted small">
        Everything below is reported by <code>api.devnet.solana.com</code> while you watch. Commitment levels
        and skipped slots are devnet&rsquo;s own. Votes, certificates and propagation are <em>not</em> on
        this trace: Alpenglow keeps them as off-chain gossip, so no outside observer can see them.
      </p>

      <div className="live-inputs">
        <label className="field" data-tip="A devnet transaction signature">
          <span>Signature</span>
          <input
            className="live-sig"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
            placeholder="paste a devnet signature"
            aria-label="Devnet transaction signature"
            data-testid="live-signature"
          />
        </label>
        {running ? (
          <button onClick={stop} data-testid="live-stop">
            Stop
          </button>
        ) : (
          <button onClick={start} data-testid="live-start" className="primary">
            Start
          </button>
        )}
      </div>

      {message && (
        <p className="live-note" role="status" data-testid="live-note">
          {message}
        </p>
      )}

      {!running && (
        <p className="live-note" data-testid="live-idle">
          Nothing is being polled. Start makes one request about every 700 ms against a shared,
          rate-limited endpoint, so it waits for you to ask.
        </p>
      )}

      <dl className="live-stats">
        <div>
          <dt>Tip slot</dt>
          <dd data-testid="live-tip">{run?.currentSlot ?? '—'}</dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd data-testid="live-observed">{run?.eventsSeen ?? 0} events</dd>
        </div>
        <div>
          <dt>Slot cadence</dt>
          <dd>{run?.meta?.slot_ms ?? '—'} ms</dd>
        </div>
        <div>
          <dt>Processed</dt>
          <dd>{commitment && commitment.processed >= 0 ? commitment.processed : '—'}</dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{commitment && commitment.confirmed >= 0 ? commitment.confirmed : '—'}</dd>
        </div>
        <div>
          <dt>Finalized</dt>
          <dd>{commitment && commitment.finalized >= 0 ? commitment.finalized : '—'}</dd>
        </div>
      </dl>

      {run?.error && (
        <p className="live-note" role="alert">
          {run.error}
        </p>
      )}
    </section>
  );
}
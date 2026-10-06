import { useEffect, useState } from 'react';
import { controller } from '../engine/controller';
import { useStore } from '../store/useStore';
import { PROTOCOL_LABEL } from '../util/format';

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
}

function wallet(): SolanaProvider | null {
  const w = (window as unknown as { solana?: SolanaProvider }).solana;
  return w && typeof w.connect === 'function' ? w : null;
}

/**
 * Capture panel for a live devnet run.
 *
 * Two ways in, in order of how little they assume about the visitor: paste a signature you
 * sent some other way, or connect a devnet wallet and send a self-transfer from here. The
 * app never creates or holds a key either way.
 *
 * What the trace can honestly show is written on the panel, because the limit is the whole
 * point: the commitment levels and the skipped slots are devnet's own, and the votes and
 * certificates in the other two modes are not, because Alpenglow keeps them off-chain.
 */
export function LivePanel() {
  const run = useStore((s) => s.runs.live);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);

  const watched = run?.txStages.submitted?.detail ?? null;
  const hasWallet = wallet() !== null;

  // The store starts with no signature, so show the one already being traced after a reload
  // of the panel rather than pretending nothing is watched.
  useEffect(() => {
    if (watched && signature === '') setSignature(watched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);

  const watch = (sig: string) => {
    const trimmed = sig.trim();
    if (!trimmed) return;
    setMessage(null);
    if (controller.watchLive(trimmed)) setSignature(trimmed);
    else setMessage('Live mode is not the one currently configured.');
  };

  const connectAndSend = async () => {
    const w = wallet();
    if (!w) return;
    setBusy(true);
    setMessage(null);
    try {
      const { publicKey } = await w.connect();
      setPubkey(publicKey.toString());
      // A devnet transaction cannot be built or signed without a client library, and this
      // panel deliberately ships without one. The connected account is still useful: paste
      // a signature from this wallet below and it is traced the same way.
      setMessage(`Connected ${publicKey.toString().slice(0, 4)}…. Send a devnet transaction from your wallet, then paste its signature here.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The wallet refused to connect.');
    } finally {
      setBusy(false);
    }
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
            onKeyDown={(e) => e.key === 'Enter' && watch(signature)}
            placeholder="paste a devnet signature"
            aria-label="Devnet transaction signature"
            data-testid="live-signature"
          />
        </label>
        <button onClick={() => watch(signature)} data-testid="live-watch">
          Trace
        </button>
        {hasWallet && (
          <button onClick={() => void connectAndSend()} disabled={busy} data-testid="live-connect">
            {pubkey ? `Connected ${pubkey.slice(0, 4)}…` : busy ? 'Connecting…' : 'Connect devnet wallet'}
          </button>
        )}
      </div>

      {message && (
        <p className="live-note" role="status" data-testid="live-note">
          {message}
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
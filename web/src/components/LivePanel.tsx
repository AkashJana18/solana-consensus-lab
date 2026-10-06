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
 * sent some other way, or connect a devnet wallet and send a transfer from here. Either way
 * the app never creates or holds a key. Sending needs a real wallet, so the module that
 * talks to one is imported only when the button is pressed.
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
  const [amount, setAmount] = useState('0.01');
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);

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
      const connected = publicKey.toString();
      setPubkey(connected);
      // Self-transfer by default: sending to the connected account needs no second address
      // and cannot put devnet SOL anywhere a visitor did not ask for.
      setRecipient((current) => current || connected);
      setMessage(`Connected ${connected.slice(0, 4)}…. Send a transfer below and it is traced as it lands.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The wallet refused to connect.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Build, sign and broadcast one devnet transfer, then trace it.
   *
   * The client library is imported here rather than at module scope so the simulator's
   * bundle never carries it: someone who only ever runs the modeled modes never downloads
   * a Solana SDK. Any failure becomes one plain sentence from `describeSendError`, because
   * a raw codec or RPC error tells a visitor nothing about what to do next.
   */
  const send = async () => {
    if (!pubkey || sending) return;
    setSending(true);
    setMessage(null);
    try {
      const { address, sendTransfer, solToLamports } = await import('../engine/devnetSend');
      const lamports = solToLamports(amount);
      if (!lamports) {
        setMessage(`"${amount}" is not an amount of devnet SOL. Try something like 0.01.`);
        return;
      }
      let to: ReturnType<typeof address>;
      try {
        to = address(recipient.trim() || pubkey);
      } catch {
        setMessage('That recipient is not a Solana address.');
        return;
      }
      const signature = await sendTransfer({ from: address(pubkey), to, lamports });
      // Start tracing immediately. Waiting for the paste step would leave the one moment
      // worth watching, the part before the transaction is seen at all, unobserved.
      setSignature(signature);
      controller.watchLive(signature);
      setMessage(
        `Sent ${amount} SOL from ${pubkey.slice(0, 4)}… to ${to.slice(0, 4)}…. Tracing ${signature.slice(0, 8)}…`,
      );
    } catch (e) {
      // A second dynamic import, but it resolves from cache by now: the first one already
      // pulled the module in, and this path only runs after it was needed.
      const { describeSendError, toSendError } = await import('../engine/devnetSend');
      setMessage(describeSendError(toSendError(e)));
    } finally {
      setSending(false);
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
          <button onClick={() => void connectAndSend()} disabled={busy || sending} data-testid="live-connect">
            {pubkey ? `Connected ${pubkey.slice(0, 4)}…` : busy ? 'Connecting…' : 'Connect devnet wallet'}
          </button>
        )}
      </div>

      {pubkey && (
        <div className="live-inputs" data-testid="live-send">
          <label className="field" data-tip="Amount of devnet SOL, up to 9 decimals">
            <span>Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount of devnet SOL"
              data-testid="live-amount"
              disabled={sending}
            />
          </label>
          <label className="field" data-tip="Devnet address to send to. Defaults to your own account.">
            <span>Recipient</span>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              aria-label="Recipient address"
              data-testid="live-recipient"
              disabled={sending}
            />
          </label>
          <button onClick={() => void send()} disabled={sending} data-testid="live-send-button">
            {sending ? 'Waiting for signature…' : 'Send on devnet'}
          </button>
          <p className="muted small send-note">
            The wallet signs; this app never sees the key. Sending uses anonymous devnet RPC, which
            rate limits: if the button reports a limit, wait a few seconds. A self-transfer is the
            simplest thing that lands.
          </p>
        </div>
      )}

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
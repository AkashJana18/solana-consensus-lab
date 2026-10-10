import { useEffect, useState } from 'react';
import { controller } from '../engine/controller';
import { useStore } from '../store/useStore';
import { PROTOCOL_LABEL } from '../util/format';

/** The legacy provider some wallets still expose, and the only thing that can hand over a public key. */
interface LegacyProvider {
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
}

function legacyWallet(): LegacyProvider | null {
  const w = (window as unknown as { solana?: LegacyProvider }).solana;
  return w && typeof w.connect === 'function' ? w : null;
}

/** What a wallet is for, once found: whichever of the two paths can produce a public key. */
type Wallet =
  | { kind: 'standard'; getAddress(): Promise<string> }
  | { kind: 'legacy'; getAddress(): Promise<string> };

/**
 * Find a wallet the same way the signing code does.
 *
 * The previous version gated the Connect button on `window.solana` but signed through Wallet
 * Standard, which are two different discovery paths. A wallet that speaks only Wallet Standard,
 * which is most of them now, was invisible to the panel even though the sender would have
 * found it: the button never appeared, so the feature was unreachable for exactly the wallets
 * it was built for. One discovery path, and the legacy provider only as a fallback.
 */
async function findWallet(): Promise<Wallet | null> {
  try {
    const { findDevnetWallet } = await import('../engine/devnetSend');
    const w = await findDevnetWallet();
    if (w) {
      return {
        kind: 'standard',
        getAddress: async () => w.accounts[0].address,
      };
    }
  } catch {
    /* discovery is best effort; the legacy provider below may still work */
  }
  const legacy = legacyWallet();
  if (legacy) {
    return {
      kind: 'legacy',
      getAddress: async () => (await legacy.connect()).publicKey.toString(),
    };
  }
  return null;
}

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
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [amount, setAmount] = useState('0.01');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  const watched = run?.txStages.submitted?.detail ?? null;
  const running = controller.liveRunning;

  // Discovery is async and the module is lazily imported, so the button appears when the
  // answer arrives rather than on first paint. Nobody without an extension ever sees it.
  useEffect(() => {
    let cancelled = false;
    void findWallet().then((w) => {
      if (!cancelled) setWallet(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const connect = async () => {
    if (!wallet || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const address = await wallet.getAddress();
      setPubkey(address);
      // Self-transfer by default: sending to the connected account needs no second address
      // and cannot put devnet SOL anywhere a visitor did not ask for.
      setRecipient((current) => current || address);
      setMessage(`Connected ${address.slice(0, 4)}…. Send a transfer below and it is traced as it lands.`);
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
      const sent = await sendTransfer({ from: address(pubkey), to, lamports });
      // Start tracing immediately. Waiting for the paste step would leave the one moment
      // worth watching, the part before the transaction is seen at all, unobserved. Sending
      // is an explicit request to watch, so it starts the loop too.
      setSignature(sent);
      controller.watchLive(sent);
      setMessage(`Sent ${amount} SOL from ${pubkey.slice(0, 4)}… to ${to.slice(0, 4)}…. Tracing ${sent.slice(0, 8)}…`);
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
        {wallet && !pubkey && (
          <button onClick={() => void connect()} disabled={busy} data-testid="live-connect">
            {busy ? 'Connecting…' : 'Connect devnet wallet'}
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
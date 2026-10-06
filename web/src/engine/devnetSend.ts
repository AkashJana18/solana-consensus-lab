/**
 * Sending a real devnet transfer from the browser, with a wallet that holds the key.
 *
 * The app still never sees a private key. It builds a transaction message, the wallet signs
 * it, and the broadcast is ours rather than the wallet's. That ordering is deliberate:
 * asking a wallet to sign-and-send hands back a signature we would have to poll in order to
 * disprove. Asking it only to sign means the RPC response we act on is the real one, so a
 * decline, an expired blockhash, a wrong cluster and a rate limit are all reportable errors
 * instead of a signature that quietly never lands.
 *
 * The signature this module returns is the one the RPC returned, not the one the wallet
 * predicted. They should agree, and preferring the RPC's means a disagreement shows up as a
 * wrong answer we would have to debug later rather than as a silent one.
 *
 * Loaded lazily: the simulator never imports this, so the wasm front end does not carry a
 * Solana client.
 */
import { mergeBytes } from '@solana/codecs-core';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  address,
  compileTransactionMessage,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getU32Encoder,
  getU64Encoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from '@solana/kit';

/** The System program. An all-zero address that holds no keys. */
export const SYSTEM_PROGRAM: Address = address('11111111111111111111111111111111');

/** The System program's Transfer instruction is index 2 in its instruction enum. */
const TRANSFER_INSTRUCTION_INDEX = 2;

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** The client `createSolanaRpc` returns, which is what every helper here takes. */
type DevnetRpc = ReturnType<typeof createSolanaRpc>;

export const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

/** Wallet Standard chain identifier. A wallet on another cluster is meant to refuse this. */
export const DEVNET_CHAIN = 'solana:devnet';

/**
 * Re-exported so the panel needs a single dynamic import: `address()` validates a base58
 * string, and importing it from here keeps kit out of the panel's own import graph.
 */
export { address } from '@solana/kit';

export interface StandardWalletAccount {
  address: string;
}

export interface StandardWallet {
  name: string;
  accounts: StandardWalletAccount[];
  features: Record<string, Record<string, unknown>>;
}

export interface SignTransactionResult {
  signedTransaction: Uint8Array;
  signature: Uint8Array;
}

/** Wallet Standard keys features by their fully qualified name. */
const SIGN_TRANSACTION_FEATURE = 'solana:signTransaction';
const SIGN_AND_SEND_FEATURE = 'solana:signAndSendTransaction';

export type SolanaSignTransaction = (
  transaction: Uint8Array,
  chain: string,
  options?: { skipSimulation?: boolean },
) => Promise<SignTransactionResult>;

/** Everything a visitor can hit, phrased as what it means rather than what threw. */
export type SendError =
  | { kind: 'no-wallet' }
  | { kind: 'rejected' }
  | { kind: 'wrong-network' }
  | { kind: 'insufficient-funds'; detail: string }
  | { kind: 'expired'; detail: string }
  | { kind: 'rate-limited'; detail: string }
  | { kind: 'malformed-response'; detail: string }
  | { kind: 'unknown'; detail: string };

export function describeSendError(e: SendError): string {
  switch (e.kind) {
    case 'no-wallet':
      return 'No Solana wallet found. Install Phantom, Solflare or Backpack, then reload this page.';
    case 'rejected':
      return 'You declined the signature in your wallet.';
    case 'wrong-network':
      return 'That wallet is not on devnet. Switch it to devnet and try again: this app never sends to mainnet.';
    case 'insufficient-funds':
      return `The devnet account does not have enough SOL for the transfer plus the fee. ${e.detail}`;
    case 'expired':
      return `The transaction expired before the cluster accepted it. ${e.detail}`;
    case 'rate-limited':
      return `api.devnet.solana.com is rate limiting anonymous traffic. Wait a few seconds and try again. ${e.detail}`;
    case 'malformed-response':
      return `The wallet returned something that is not a signed transaction. ${e.detail}`;
    case 'unknown':
      return `The transfer did not go through. ${e.detail}`;
  }
}

/**
 * "0.01" to lamports, without going through a float.
 *
 * SOL is a decimal amount whose binary form is inexact: 0.1 * 1e9 in floating point is
 * 100000000.00000001, so a float round-trip sends the wrong number of lamports.
 */
export function solToLamports(sol: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(sol.trim());
  if (!match) return null;
  const [, whole, frac = ''] = match;
  const lamports = BigInt(whole) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, '0'));
  return lamports > 0n ? lamports : null;
}

export function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * A System transfer, encoded by hand.
 *
 * kit 8 ships transaction plumbing but no program instruction builders, and Transfer is the
 * one instruction whose encoding the protocol fixes: a little-endian u32 index of 2, then a
 * little-endian u64 of lamports, against program 1111...1111 with a writable-signer source
 * and a writable destination. There is no lookup table, and no compute budget instruction.
 */
export function transferInstruction(from: Address, to: Address, amount: bigint): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: AccountRole.WRITABLE_SIGNER },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data: mergeBytes([
      new Uint8Array(getU32Encoder().encode(TRANSFER_INSTRUCTION_INDEX)),
      new Uint8Array(getU64Encoder().encode(amount)),
    ]),
  };
}

export interface TransferRequest {
  from: Address;
  to: Address;
  lamports: bigint;
}

export interface BuiltTransfer {
  /** Compiled message wire bytes, which is what a wallet signs. */
  bytes: Uint8Array;
  compiled: ReturnType<typeof compileTransactionMessage>;
  message: ReturnType<typeof setTransactionMessageLifetimeUsingBlockhash>;
  lastValidBlockHeight: bigint;
}

/** Assemble an unsigned transfer against a blockhash the cluster will still accept. */
export async function buildTransfer(rpc: DevnetRpc, req: TransferRequest): Promise<BuiltTransfer> {
  const { value } = await rpc.getLatestBlockhash().send();
  const { blockhash, lastValidBlockHeight } = value;
  const withPayer = setTransactionMessageFeePayer(req.from, createTransactionMessage({ version: 'legacy' }));
  const withTransfer = appendTransactionMessageInstructions(
    [transferInstruction(req.from, req.to, req.lamports)],
    withPayer,
  );
  const message = setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, withTransfer);
  const compiled = compileTransactionMessage(message);
  return {
    bytes: new Uint8Array(getCompiledTransactionMessageEncoder().encode(compiled)),
    compiled,
    message,
    lastValidBlockHeight,
  };
}

/** Broadcast signed transaction bytes and return the signature the RPC reports. */
export async function broadcast(rpc: DevnetRpc, signedTransaction: Uint8Array): Promise<string> {
  const transaction = getTransactionDecoder().decode(signedTransaction);
  const wire = getBase64EncodedWireTransaction(transaction);
  // sendTransaction resolves to the signature itself, base58 encoded.
  return await rpc.sendTransaction(wire, { encoding: 'base64' }).send();
}

/** Find a Wallet Standard wallet that can sign for devnet. */
export async function findDevnetWallet(): Promise<StandardWallet | null> {
  const app = (await import('@wallet-standard/app')) as unknown as {
    getWallets(): { get(): readonly StandardWallet[] };
  };
  const wallets = app.getWallets().get() ?? [];
  return (
    wallets.find(
      (w) =>
        w.accounts.length > 0 &&
        (typeof w.features[SIGN_TRANSACTION_FEATURE] === 'object' ||
          typeof w.features['solana:'] === 'object'),
    ) ?? null
  );
}

export interface SendTransferOptions {
  rpc?: DevnetRpc;
  /** Overridable so a test can drive the wallet and RPC without a cluster. */
  sign?: SolanaSignTransaction;
  wallet?: StandardWallet | null;
}

/**
 * Build, sign and broadcast one devnet transfer, resolving to its signature.
 *
 * Rejects with a `SendError`, never a raw library error, so the panel can say what happened
 * without inspecting error codes.
 */
export async function sendTransfer(req: TransferRequest, opts: SendTransferOptions = {}): Promise<string> {
  const wallet = opts.wallet !== undefined ? opts.wallet : await findDevnetWallet();
  if (!wallet) throw { kind: 'no-wallet' } satisfies SendError;

  const sign =
    opts.sign ??
    ((wallet.features[SIGN_TRANSACTION_FEATURE]?.signTransaction ??
      // Some wallets group the Solana features under a namespace object instead.
      (wallet.features['solana:'] as Record<string, unknown> | undefined)?.signTransaction) as
      | SolanaSignTransaction
      | undefined);
  if (!sign) {
    const canSend =
      typeof wallet.features[SIGN_AND_SEND_FEATURE]?.signAndSendTransaction === 'function' ||
      typeof (wallet.features['solana:'] as Record<string, unknown> | undefined)?.signAndSendTransaction === 'function';
    throw {
      kind: 'unknown',
      detail: canSend
        ? `${wallet.name} only offers sign-and-send, so this build cannot verify the broadcast itself.`
        : `${wallet.name} does not expose the solana:signTransaction feature.`,
    } satisfies SendError;
  }

  const rpc = opts.rpc ?? createSolanaRpc(devnet(DEVNET_RPC_URL));
  const built = await buildTransfer(rpc, req);

  let result: SignTransactionResult;
  try {
    result = await sign(built.bytes, DEVNET_CHAIN);
  } catch (e) {
    throw classifyWalletError(e);
  }
  if (!(result?.signedTransaction instanceof Uint8Array) || result.signedTransaction.length === 0) {
    throw {
      kind: 'malformed-response',
      detail: `${wallet.name} returned no transaction bytes.`,
    } satisfies SendError;
  }

  try {
    return await broadcast(rpc, result.signedTransaction);
  } catch (e) {
    throw classifyRpcError(e);
  }
}

function classifyWalletError(e: unknown): SendError {
  const message = e instanceof Error ? e.message : String(e ?? '');
  const code = (e as { code?: number } | null)?.code;
  // Wallet Standard surfaces a decline as 4001, the number web3.js used.
  if (code === 4001 || /reject|declin|cancel|denied|user refused/i.test(message)) return { kind: 'rejected' };
  if (/chain|cluster|network|devnet|mainnet|unsupported account/i.test(message)) return { kind: 'wrong-network' };
  if (/insufficient/i.test(message)) return { kind: 'insufficient-funds', detail: message };
  return { kind: 'unknown', detail: message || 'The wallet refused without giving a reason.' };
}

function classifyRpcError(e: unknown): SendError {
  const message = e instanceof Error ? e.message : String(e ?? '');
  const code = (e as { code?: number; data?: { code?: number } } | null)?.code;
  if (code === 429 || /429|too many requests|rate.?limit/i.test(message)) {
    return { kind: 'rate-limited', detail: message };
  }
  if (/blockhash not found|expired|Blockhash/i.test(message)) return { kind: 'expired', detail: message };
  if (/insufficient lamports|insufficient funds|no record of a prior credit|insufficient/i.test(message)) {
    return { kind: 'insufficient-funds', detail: message };
  }
  return { kind: 'unknown', detail: message || 'The RPC gave no reason.' };
}

/** Normalise anything thrown into a `SendError`, so the panel never prints a library error. */
export function toSendError(e: unknown): SendError {
  if (e && typeof e === 'object' && 'kind' in e) return e as SendError;
  return { kind: 'unknown', detail: e instanceof Error ? e.message : String(e ?? '') };
}

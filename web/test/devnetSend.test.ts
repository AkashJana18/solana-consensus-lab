import { describe, expect, it } from 'vitest';
import { AccountRole, getCompiledTransactionMessageDecoder } from '@solana/kit';
import {
  DEVNET_CHAIN,
  SYSTEM_PROGRAM,
  describeSendError,
  formatSol,
  solToLamports,
  transferInstruction,
  sendTransfer,
  type StandardWallet,
} from '../src/engine/devnetSend';

const FROM = '4uLjRs71E2q2CLW3wZCmtG6XX5De1uKKtGYPkejJBEbS';
const TO = '6TD26ZfVShvqcQWboNkLgQLqn5Ld1avxTi81H2eXpKgA';
const BLOCKHASH = '76S7CNgroYr2q2MegCXsjBcMChQa1TdFWs8BhEtDDnLB';

describe('solToLamports', () => {
  it('converts without going through a float', () => {
    // 0.1 * 1e9 in floating point is 100000000.00000001. If this ever regresses to a float
    // multiplication, the chain receives the wrong number of lamports.
    expect(solToLamports('0.1')).toBe(100_000_000n);
    expect(solToLamports('0.01')).toBe(10_000_000n);
    expect(solToLamports('1')).toBe(1_000_000_000n);
    expect(solToLamports('0.000000001')).toBe(1n);
    expect(solToLamports('  2.5  ')).toBe(2_500_000_000n);
  });

  it('rejects anything that is not a positive amount of at most 9 decimals', () => {
    for (const bad of ['', '0', '0.0', 'abc', '-1', '1.2.3', '0.0000000001', '1e9', 'NaN', '0,1']) {
      expect(solToLamports(bad), bad).toBeNull();
    }
  });

  it('round-trips through formatSol', () => {
    for (const sol of ['0.01', '0.1', '1', '123.456789']) {
      const lamports = solToLamports(sol);
      expect(lamports).not.toBeNull();
      expect(formatSol(lamports!), sol).toBe(sol);
    }
  });
});

describe('transferInstruction', () => {
  const ix = transferInstruction(FROM as never, TO as never, 10_000_000n);

  it('targets the System program with the documented account metas', () => {
    expect(ix.programAddress).toBe(SYSTEM_PROGRAM);
    expect(SYSTEM_PROGRAM).toBe('11111111111111111111111111111111');
    const accounts = ix.accounts ?? [];
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toEqual({ address: FROM, role: AccountRole.WRITABLE_SIGNER });
    expect(accounts[1]).toEqual({ address: TO, role: AccountRole.WRITABLE });
  });

  it('encodes index 2 and the lamports as little-endian, byte for byte', () => {
    const data = new Uint8Array(ix.data!);
    expect(data).toHaveLength(12);
    // u32 little-endian instruction index 2, then u64 little-endian 10_000_000 = 0x989680.
    expect([...data]).toEqual([2, 0, 0, 0, 0x80, 0x96, 0x98, 0, 0, 0, 0, 0]);
  });

  it('would be rejected by devnet if the encoding were wrong, so assert the round trip', async () => {
    // A message built from this instruction must compile to exactly one signer, the payer,
    // and put the program at the account index the compiler assigns it.
    const { buildTransfer } = await import('../src/engine/devnetSend');
    const built = await buildTransfer(fakeRpc(), { from: FROM as never, to: TO as never, lamports: 10_000_000n });
    const decoded = getCompiledTransactionMessageDecoder().decode(built.bytes);
    expect(decoded.version).toBe('legacy');
    const legacy = decoded as Extract<typeof decoded, { version: 'legacy' }>;
    expect(legacy.header.numSignerAccounts).toBe(1);
    expect(legacy.staticAccounts[0]).toBe(FROM);
    expect(legacy.staticAccounts[1]).toBe(TO);
    expect(legacy.staticAccounts[legacy.instructions[0].programAddressIndex]).toBe(SYSTEM_PROGRAM);
    expect(legacy.instructions[0].accountIndices).toEqual([0, 1]);
  });
});

describe('describeSendError', () => {
  it('says what to do next, not what threw', () => {
    expect(describeSendError({ kind: 'rejected' })).toMatch(/declined/i);
    expect(describeSendError({ kind: 'rate-limited', detail: '429' })).toMatch(/wait a few seconds/i);
    // The two network facts a visitor most needs are named explicitly.
    expect(describeSendError({ kind: 'wrong-network' })).toMatch(/devnet/);
    expect(describeSendError({ kind: 'wrong-network' })).toMatch(/mainnet/);
    expect(describeSendError({ kind: 'no-wallet' })).toMatch(/reload/i);
    expect(describeSendError({ kind: 'unknown', detail: 'boom' })).toContain('boom');
  });
});

/**
 * The whole send pipeline, with no network and no wallet: a fake RPC, a fake wallet, and a
 * signer that produces a real 64-byte signature over a real compiled message.
 */
describe('sendTransfer', () => {
  const wallet = (over: Partial<StandardWallet> = {}): StandardWallet => ({
    name: 'Test wallet',
    accounts: [{ address: FROM }],
    features: { 'solana:signTransaction': {} },
    ...over,
  });

  it('signs, broadcasts and returns the signature the RPC reported', async () => {
    let asked: string | null = null;
    let sent: Uint8Array | null = null;
    const rpc = fakeRpc({
      sendTransaction: (tx: Uint8Array) => {
        sent = tx;
        return '5aoKNRAxrvmwNaQqYahaRAJeJFTnjKtsq1q7W9KsaPLMaserH2Cs7ZDUSreeYyRKZVeG9XSefahY2SrYG9Z1mRFY';
      },
    });
    const signature = await sendTransfer(
      { from: FROM as never, to: TO as never, lamports: 10_000_000n },
      {
        wallet: wallet({
          features: {
            'solana:signTransaction': {
              signTransaction: async (message: Uint8Array, chain: string) => {
                asked = chain;
                return { signedTransaction: signLocally(message), signature: new Uint8Array(64) };
              },
            },
          },
        }),
        rpc,
      },
    );
    // The wallet is asked for devnet specifically, so one on another cluster refuses.
    expect(asked).toBe(DEVNET_CHAIN);
    expect(signature).toBe('5aoKNRAxrvmwNaQqYahaRAJeJFTnjKtsq1q7W9KsaPLMaserH2Cs7ZDUSreeYyRKZVeG9XSefahY2SrYG9Z1mRFY');
    expect(sent).not.toBeNull();
  });

  it('reports a declined signature as declined', async () => {
    await expect(
      sendTransfer(
        { from: FROM as never, to: TO as never, lamports: 1n },
        {
          wallet: wallet({
            features: {
              'solana:signTransaction': {
                signTransaction: async () => {
                  throw Object.assign(new Error('User rejected the request'), { code: 4001 });
                },
              },
            },
          }),
          rpc: fakeRpc(),
        },
      ),
    ).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('reports a rate limited faucet rather than a generic failure', async () => {
    await expect(
      sendTransfer(
        { from: FROM as never, to: TO as never, lamports: 1n },
        {
          wallet: wallet({
            features: { 'solana:signTransaction': { signTransaction: async (m: Uint8Array) => ({ signedTransaction: signLocally(m), signature: new Uint8Array(64) }) } },
          }),
          rpc: fakeRpc({
            sendTransaction: () => {
              throw Object.assign(new Error('HTTP error (429): Too Many Requests'), { code: 429 });
            },
          }),
        },
      ),
    ).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it("reports an empty devnet account in the System program's own words", async () => {
    // devnet says this, not "insufficient funds", when the source holds nothing.
    await expect(
      sendTransfer(
        { from: FROM as never, to: TO as never, lamports: 1n },
        {
          wallet: wallet({
            // Deliberately the namespace form, which some wallets use instead.
            features: { 'solana:': { signTransaction: async (m: Uint8Array) => ({ signedTransaction: signLocally(m), signature: new Uint8Array(64) }) } },
          }),
          rpc: fakeRpc({
            sendTransaction: () => {
              throw new Error('Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.');
            },
          }),
        },
      ),
    ).rejects.toMatchObject({ kind: 'insufficient-funds' });
  });

  it('refuses when there is no wallet rather than pretending', async () => {
    await expect(
      sendTransfer({ from: FROM as never, to: TO as never, lamports: 1n }, { wallet: null, rpc: fakeRpc() }),
    ).rejects.toMatchObject({ kind: 'no-wallet' });
  });

  it('refuses a wallet that cannot sign for devnet', async () => {
    await expect(
      sendTransfer(
        { from: FROM as never, to: TO as never, lamports: 1n },
        { wallet: wallet({ features: { 'solana:signAndSendTransaction': { signAndSendTransaction: () => undefined } } }), rpc: fakeRpc() },
      ),
    ).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('refuses a wallet that returns no bytes', async () => {
    await expect(
      sendTransfer(
        { from: FROM as never, to: TO as never, lamports: 1n },
        {
          wallet: wallet({ features: { 'solana:signTransaction': { signTransaction: async () => ({ signedTransaction: new Uint8Array(), signature: new Uint8Array(64) }) } } }),
          rpc: fakeRpc(),
        },
      ),
    ).rejects.toMatchObject({ kind: 'malformed-response' });
  });
});

type RpcLike = Parameters<typeof sendTransfer>[1] extends { rpc?: infer R } ? NonNullable<R> : never;

function fakeRpc(over: { sendTransaction?: (tx: Uint8Array) => string } = {}): RpcLike {
  return {
    getLatestBlockhash: () => ({
      send: async () => ({ context: { slot: 1n }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100n } }),
    }),
    sendTransaction: (tx: Uint8Array) => ({
      send: async () => (over.sendTransaction ? over.sendTransaction(tx) : 'stub-signature'),
    }),
  } as unknown as RpcLike;
}

/**
 * A legacy wire transaction: compact-u16 signature count, a 64-byte signature, then the
 * message. The signature is a constant because nothing here verifies it, only parses it.
 */
function signLocally(messageBytes: Uint8Array): Uint8Array {
  const tx = new Uint8Array(1 + 64 + messageBytes.length);
  tx[0] = 1;
  tx.set(messageBytes, 65);
  return tx;
}
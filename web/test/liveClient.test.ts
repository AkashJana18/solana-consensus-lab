import { describe, expect, it, vi } from 'vitest';
import { DEVNET_RPC, LiveClient, maskBlockHash } from '../src/engine/liveClient';
import type { Traced } from '../src/engine/types';

const SIG = '5wHu1rJ2Xh1cVgQ9kP3nT7yZ4bC6dE8fG0hI2jK4lM6nO8pQ';

/** Minimal JSON-RPC fake: only the methods the client calls, with a scripted slot tip. */
function fakeRpc(opts: { tip: () => number; blocks?: (string | null)[]; status?: () => string; blockTime?: number | null }) {
  const calls: { method: string; params: unknown[] }[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ method: body.method, params: body.params });
    // The two param shapes devnet rejects if they are wrong, asserted here so a mocked test
    // cannot pass while the real endpoint fails. Both were found against the public RPC.
    if (body.method === 'getBlocks') {
      const commitment = (body.params[2] as { commitment?: string } | undefined)?.commitment;
      if (commitment === 'processed') throw new Error('devnet: -32602 Method does not support commitment below confirmed');
    }
    if (body.method === 'getSignatureStatuses' && !Array.isArray(body.params[0])) {
      throw new Error('devnet: -32602 Invalid params: expected a sequence');
    }
    const result =
      body.method === 'getSlot'
        ? opts.tip()
        : body.method === 'getBlocks'
          ? (opts.blocks ?? [])
          : body.method === 'getSignatureStatuses'
            ? { value: [{ slot: 508100000, confirmationStatus: opts.status ? opts.status() : null, err: null }] }
            : body.method === 'getBlockTime'
              ? (opts.blockTime ?? null)
              : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function collect(client: LiveClient): Promise<Traced[]> {
  const seen: Traced[] = [];
  client.onEvents((b) => seen.push(...b.events));
  return seen;
}

describe('maskBlockHash', () => {
  it('reduces a base58 hash to an odd 53-bit integer', () => {
    const h = maskBlockHash('3n1mY2kC7xQ9pL4vB6dF8gH0jK2lM4nO6pQ8rS0tU');
    expect(Number.isSafeInteger(h)).toBe(true);
    expect(h).toBeLessThanOrEqual(2 ** 53 - 1);
    // The Rust side ORs in a low bit so a hash is never 0; equality is all this is used for.
    expect(h % 2).toBe(1);
  });

  it('is stable, and survives the JSON round trip the wasm boundary relies on', () => {
    const a = maskBlockHash('AABBCCDD');
    expect(maskBlockHash('AABBCCDD')).toBe(a);
    expect(JSON.parse(JSON.stringify({ h: a })).h).toBe(a);
    expect(maskBlockHash('AABBCCDE')).not.toBe(a);
  });
});

describe('LiveClient', () => {
  it('traces slots and blocks from the tip, marking skipped slots', async () => {
    let tip = 100;
    const rpc = fakeRpc({ tip: () => tip, blocks: ['h1', null, 'h3'] });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true });
    const seen = await collect(client);
    await client.init();
    client.watch(SIG);

    // The connection state is announced when a trace is armed, not when the app boots.
    expect(seen.some((e) => e.type === 'rpc_conn' && e.state === 'connecting')).toBe(true);
    await client.pollOnceForTest();
    expect(seen.some((e) => e.type === 'slot_start' && e.slot === 100)).toBe(true);

    const next = await collect(client);
    tip = 103;
    await client.pollOnceForTest();

    const kinds = next.map((e) => e.type);
    expect(kinds).toContain('block_produced');
    expect(kinds).toContain('slot_skipped');
    const skipped = next.find((e) => e.type === 'slot_skipped') as Extract<Traced, { type: 'slot_skipped' }>;
    expect(skipped.slot).toBe(102);
    expect(next.some((e) => e.type === 'slot_start' && e.slot === 103)).toBe(true);
  });

  it('emits commitment and tx_stage exactly once per level as devnet advances', async () => {
    let level = 'processed';
    const rpc = fakeRpc({ tip: () => 100, status: () => level });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true, signature: SIG });
    await client.init();
    const seen = await collect(client);

    await client.pollOnceForTest();
    level = 'confirmed';
    await client.pollOnceForTest();
    level = 'finalized';
    await client.pollOnceForTest();
    // Poll again at the same level: nothing should be duplicated.
    await client.pollOnceForTest();

    const commitments = seen.filter((e) => e.type === 'commitment') as Extract<Traced, { type: 'commitment' }>[];
    expect(commitments.map((c) => c.level)).toEqual(['processed', 'confirmed', 'finalized']);

    const stages = seen.filter((e) => e.type === 'tx_stage') as Extract<Traced, { type: 'tx_stage' }>[];
    expect(stages.map((s) => s.stage)).toEqual(['included_in_block', 'confirmed', 'finalized']);
    // tx 0 is what the timeline and the stepper treat as the hero transaction.
    expect(stages.every((s) => s.tx === 0)).toBe(true);
    expect(stages[0].detail).toBe(SIG);
  });

  it('keeps event times monotonic, because the buffer re-sorts the whole array otherwise', async () => {
    let tip = 100;
    const rpc = fakeRpc({ tip: () => tip, blocks: ['a', 'b'], status: () => 'finalized', blockTime: Math.floor(Date.now() / 1000) });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true, signature: SIG });
    await client.init();
    const seen = await collect(client);
    for (let i = 0; i < 4; i++) {
      tip += 2;
      await client.pollOnceForTest();
    }
    const times = seen.map((e) => e.t);
    expect(times.length).toBeGreaterThan(4);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  });

  it('grows its horizon to the newest observation, since it declares none', async () => {
    let tip = 100;
    const rpc = fakeRpc({ tip: () => tip, blocks: ['a'] });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true });
    await client.init();
    const first = client.end;
    tip = 140;
    await client.pollOnceForTest();
    expect(client.end).toBeGreaterThan(first);
    expect(client.now).toBe(client.end);
  });

  it('backs off on a 429 and says so, rather than looking frozen', async () => {
    let fail = true;
    const impl = (async () => {
      if (fail) return new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 7 }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new LiveClient({ fetchImpl: impl, manual: true });
    const seen = await collect(client);
    await client.init();
    await client.pollOnceForTest();
    fail = false;
    await client.pollOnceForTest();

    const retry = seen.find((e) => e.type === 'rpc_conn' && e.state === 'retrying') as Extract<Traced, { type: 'rpc_conn' }> | undefined;
    expect(retry).toBeDefined();
    expect(retry!.detail).toMatch(/429/);
    // Recovers once the endpoint stops throttling.
    expect(seen.some((e) => e.type === 'rpc_conn' && e.state === 'connected')).toBe(true);
  });

  it('reports an endpoint failure without throwing out of init', async () => {
    const impl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const client = new LiveClient({ fetchImpl: impl, manual: true });
    const seen = await collect(client);
    await expect(client.init()).resolves.toMatchObject({ protocol: 'live', n: 1 });
    // init() no longer touches the network, so a bad endpoint is first heard in a poll, and
    // it is reported as a connection state rather than thrown at the caller.
    client.watch(SIG);
    await client.pollOnceForTest();
    expect(seen.some((e) => e.type === 'rpc_conn' && e.state === 'error')).toBe(true);
  });

  it('makes no request at all until start, so a shared link spends nobody\'s quota', async () => {
    const rpc = fakeRpc({ tip: () => 100 });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true });
    await client.init();
    client.watch(SIG);
    // The whole point of the gate: configuration alone reaches no third party.
    expect(rpc.calls).toHaveLength(0);
    expect(client.started).toBe(false);

    client.start();
    expect(client.started).toBe(true);
    await client.pollOnceForTest();
    expect(rpc.calls.length).toBeGreaterThan(0);
  });

  it('stops asking on stop(), and says so rather than looking frozen', async () => {
    const rpc = fakeRpc({ tip: () => 100 });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true });
    const seen = await collect(client);
    await client.init();
    client.watch(SIG);
    client.start();
    await client.pollOnceForTest();
    const before = rpc.calls.length;

    client.stop();
    expect(client.started).toBe(false);
    await client.pollOnceForTest();
    // A stopped run makes no further request, and records why it went quiet.
    expect(rpc.calls).toHaveLength(before);
    expect(seen.some((e) => e.type === 'rpc_conn' && e.state === 'stopped')).toBe(true);
  });

  it('recovers from a request that never answers, instead of dying silently', async () => {
    // A request that accepts the connection and then never settles used to end the loop for
    // good: the single-flight guard returns before the finally that re-arms the timer, and
    // nothing was surfaced, so the trace just stopped. Every request here hangs; the client
    // must give up on its own deadline, say so, and keep asking.
    let calls = 0;
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      // Honour the abort signal the way real fetch does, or the deadline can never fire:
      // the whole point of the test is a request that is cut short from the outside.
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 100 }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new LiveClient({ fetchImpl: impl, pollMs: 10, rpcTimeoutMs: 25 });
    const seen = await collect(client);
    await client.init();
    client.watch(SIG);
    client.start();

    await vi.waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 2_000, interval: 10 });
    const retry = seen.find((e) => e.type === 'rpc_conn' && e.state === 'retrying') as Extract<Traced, { type: 'rpc_conn' }> | undefined;
    expect(retry, 'a hung request must be reported, not hidden').toBeDefined();
    expect(retry!.detail).toMatch(/timed out/);
    client.stop();
  });

  it('measures the slot cadence instead of assuming mainnet 400 ms', async () => {
    let tip = 100;
    let elapsedUs = 1_000_000;
    const rpc = fakeRpc({ tip: () => tip, blocks: Array.from({ length: 8 }, (_, i) => `h${i}`) });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true, clock: () => elapsedUs });
    await client.init();
    expect(client.meta?.slot_ms).toBe(400); // the fallback until two samples exist
    await client.pollOnceForTest();
    // 8 slots over 2.4 s: 300 ms each, which is not mainnet's 400.
    elapsedUs += 2_400_000;
    tip = 108;
    await client.pollOnceForTest();
    expect(client.meta?.slot_ms).toBe(300);
  });

  it('never re-observes a slot it has already reported', async () => {
    let tip = 100;
    const rpc = fakeRpc({ tip: () => tip, blocks: ['a', 'b'] });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true });
    await client.init();
    await client.pollOnceForTest();
    const seen = await collect(client);
    tip = 102;
    await client.pollOnceForTest();
    tip = 102; // tip stalls, getBlocks is not called again
    await client.pollOnceForTest();
    expect(seen.filter((e) => e.type === 'block_produced')).toHaveLength(2);
  });

  it('announces the measured cadence once, since the UI snapshots meta at configure', async () => {
    let tip = 100;
    let elapsedUs = 1_000_000;
    const rpc = fakeRpc({ tip: () => tip, blocks: Array.from({ length: 4 }, (_, i) => `h${i}`) });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true, clock: () => elapsedUs });
    await client.init();
    const seen = await collect(client);
    await client.pollOnceForTest();
    elapsedUs += 2_000_000; // 4 slots over 2 s
    tip = 104;
    await client.pollOnceForTest();
    elapsedUs += 2_000_000;
    tip = 108;
    await client.pollOnceForTest();

    const cadence = seen.filter((e): e is Extract<Traced, { type: 'log' }> => e.type === 'log' && e.msg.includes('cadence'));
    expect(cadence).toHaveLength(1);
    expect(cadence[0].msg).toContain('500 ms per slot');
  });

  it('ignores an implausible cadence sample from a late poll', async () => {
    let tip = 100;
    let elapsedUs = 1_000_000;
    const rpc = fakeRpc({ tip: () => tip, blocks: ['a', 'b'] });
    const client = new LiveClient({ fetchImpl: rpc.impl, manual: true, clock: () => elapsedUs });
    await client.init();
    await client.pollOnceForTest();
    elapsedUs += 30_000_000; // 30 s for two slots is a stalled endpoint, not a cadence
    tip = 102;
    await client.pollOnceForTest();
    expect(client.meta?.slot_ms).toBe(400);
  });

  it('defaults to the public devnet endpoint', () => {
    expect(DEVNET_RPC).toBe('https://api.devnet.solana.com');
  });
});
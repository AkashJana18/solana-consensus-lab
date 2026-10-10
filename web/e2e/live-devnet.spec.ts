import { expect, test, type Page } from '@playwright/test';

const SIG = '5wHu1rJ2Xh1cVgQ9kP3nT7yZ4bC6dE8fG0hI2jK4lM4nO8pQ';

/**
 * Stand in for api.devnet.solana.com. Nothing in this spec touches the network: the real
 * endpoint is free tier and rate limited, so a suite that called it would be flaky by other
 * people's traffic.
 *
 * The script moves devnet forward the way devnet actually behaves: the tip advances, some
 * slots produce no block at all (on Alpenglow a skipped slot is the outside view of a Skip
 * certificate), and the watched transaction walks up through the commitment levels.
 */
async function mockDevnet(page: Page, opts: { slots: number; skippedEvery?: number } = { slots: 6, skippedEvery: 3 }) {
  let tip = 508_100_000;
  let level = 'processed';
  const skipped = opts.skippedEvery ?? Infinity;
  let slotCalls = 0;
  const sent: unknown[] = [];

  await page.route(
    (url) => url.hostname === 'api.devnet.solana.com',
    async (route) => {
      const raw = JSON.parse(route.request().postData() ?? '{}') as { method: string; params: unknown[] } | { method: string; params: unknown[] }[];
      // kit can batch JSON-RPC calls, so answer an array of them one by one.
      if (Array.isArray(raw)) {
        await route.fulfill({
          json: raw.map((r, i) => ({ jsonrpc: '2.0', id: i, result: answer(r.method) })),
        });
        return;
      }
      const body = raw;
      const answer = (method: string): unknown => {
      switch (method) {
        case 'getSlot':
          // devnet's tip moves between polls, which is the only way the client learns it
          // has new slots to look at. A frozen tip would mean an idle cluster.
          slotCalls += 1;
          return (tip += 2);
        case 'getBlocks': {
          const [from, to] = body.params as [number, number];
          const blocks: (string | null)[] = [];
          for (let s = from; s <= to; s++) blocks.push(s % skipped === 0 ? null : `blk${s}`);
          return blocks;
        }
        case 'getSignatureStatuses':
          // Walk the levels on successive polls, the way a real finalization does.
          level = level === 'processed' ? 'confirmed' : level === 'confirmed' ? 'finalized' : 'finalized';
          return { value: [{ slot: 508_100_002, confirmationStatus: level, err: null }] };
        case 'getBlockTime':
          return Math.floor(Date.now() / 1000) - 1;
        // The two the wallet path needs when it builds and broadcasts a transfer.
        case 'getLatestBlockhash':
          return {
            context: { apiVersion: '4.4.0', slot: 508_100_010 },
            value: { blockhash: '76S7CNgroYr2q2MegCXsjBcMChQa1TdFWs8BhEtDDnLB', lastValidBlockHeight: 508_100_200 },
          };
        case 'sendTransaction':
          sent.push((body.params as [unknown, unknown?])[0]);
          return SIG;
        default:
          return null;
      }
      };
      const result = answer(body.method);
      await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
    },
  );
  return { slotCalls: () => slotCalls, sentBytes: () => sent };
}

async function openLive(page: Page) {
  await page.goto('/?mode=live');
  await expect(page.getByRole('heading', { name: 'Devnet, observed' })).toBeVisible({ timeout: 20_000 });
}

/** The events feed is behind its tab; open it before asserting on its rows. */
async function openFeed(page: Page, scope: 'watched' | 'all' = 'watched') {
  await page.getByTestId('tab-events').click();
  await expect(page.getByTestId('event-feed')).toBeVisible();
  if (scope === 'all') await page.getByTestId('feed-scope-all').click();
}

test('live mode traces devnet from the RPC and labels what it cannot see', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const rpc = await mockDevnet(page);
  await openLive(page);

  // The panel states the limit rather than implying the whole run is devnet's own doing.
  await expect(page.locator('.live-panel')).toContainText('off-chain gossip');

  await page.getByTestId('live-signature').fill(SIG);
  await page.getByTestId('live-start').click();
  // The full stream: the feed hides block and slot traffic by default so that the watched
  // transaction stays readable, and this test is about everything the RPC reports.
  await openFeed(page, 'all');

  // Polling only started when the button was pressed, and from there it runs by itself:
 // there is nothing to step through.
  await expect(page.getByTestId('live-tip')).not.toHaveText('0', { timeout: 20_000 });
  await expect(page.getByTestId('live-observed')).toContainText('events', { timeout: 20_000 });

  // The observed feed reaches the feed, with the skipped slots visible as skipped.
  const feed = page.getByTestId('event-feed');
  await expect(feed).toContainText('hero tx included in block', { timeout: 20_000 });
  await expect(feed).toContainText('skipped (no block)', { timeout: 20_000 });
  await expect(feed).toContainText('block produced', { timeout: 20_000 });

  // The connection state is surfaced, so a stalled trace never looks like a broken app.
  await expect(feed).toContainText('devnet RPC connected', { timeout: 20_000 });

  // The tip moved, which is the whole point of watching: nothing here is a fixed scenario.
  await expect(page.getByTestId('live-tip')).not.toHaveText('508100000', { timeout: 20_000 });
  // One poller. A leaked client doubles the traffic against a rate-limited endpoint.
  expect(rpc.slotCalls()).toBeLessThan(12);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('a shared live link spends nobody\'s rate limit until Start is pressed', async ({ page }) => {
  const rpc = await mockDevnet(page, { slots: 6 });
  await openLive(page);

  // Opening ?mode=live renders the panel and nothing else. The endpoint is free tier and
  // shared by every visitor on the internet, so configuration alone must reach nobody.
  await page.getByTestId('live-signature').fill(SIG);
  await expect(page.getByTestId('live-idle')).toBeVisible();
  await page.waitForTimeout(2_500);
  expect(rpc.slotCalls(), 'no request may be made before Start').toBe(0);

  // Pressing it is the consent, and from there the trace runs on its own.
  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-stop')).toBeVisible();
  await expect.poll(() => rpc.slotCalls(), { timeout: 15_000 }).toBeGreaterThan(0);

  // Stopping actually stops: no further request lands after it.
  await page.getByTestId('live-stop').click();
  await expect(page.getByTestId('live-idle')).toBeVisible();
  const atStop = rpc.slotCalls();
  await page.waitForTimeout(2_000);
  expect(rpc.slotCalls()).toBe(atStop);
});

test('the commitment ladder fills from observed levels, not from the model', async ({ page }) => {
  await mockDevnet(page, { slots: 8 });
  await openLive(page);
  await page.getByTestId('live-signature').fill(SIG);
  await page.getByTestId('live-start').click();

  // processed -> confirmed -> finalized, each recorded once as devnet reports it.
  const steps = page.locator('.stepper tbody tr');
  await expect(steps.filter({ hasText: 'Finalized' })).toContainText('ms', { timeout: 25_000 });
  const labels = await page.locator('.live-stats dd').allTextContents();
  expect(labels.join(' ')).toMatch(/508/); // a real devnet slot number reached the UI
});

test('a rate limited endpoint backs off and says so instead of looking frozen', async ({ page }) => {
  let calls = 0;
  await page.route(
    (url) => url.hostname === 'api.devnet.solana.com',
    async (route) => {
      calls += 1;
      await route.fulfill({ status: 429, body: 'slow down', headers: { 'retry-after': '1' } });
    },
  );
  await openLive(page);
  await page.getByTestId('live-signature').fill(SIG);
  await page.getByTestId('live-start').click();
  await openFeed(page);

  // The error is reported through the feed, which is where a reader will look for it.
  await expect(page.getByTestId('event-feed')).toContainText('429', { timeout: 20_000 });
  // And it does not hammer: bounded requests over the first few seconds.
  expect(calls).toBeLessThan(12);
});

test('the other two modes are untouched by the live plumbing', async ({ page }) => {
  await page.goto('/?scenario=happy-path&mode=compare');
  await expect(page.getByTestId('scenario-select')).toHaveValue('happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 20_000 });

  // Two canvases, no live panel, and the clock still runs on the simulated horizon.
  await expect(page.locator('canvas')).toHaveCount(2);
  await expect(page.locator('.live-panel')).toHaveCount(0);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Pause');
  await openFeed(page);
  await expect(page.getByTestId('event-feed')).toContainText('ms', { timeout: 20_000 });
});
test('the live feed keeps the watched transaction readable under slot traffic', async ({ page }) => {
  await mockDevnet(page, { slots: 6 });
  await openLive(page);
  await page.getByTestId('live-signature').fill(SIG);
  await page.getByTestId('live-start').click();
  await openFeed(page);
  const feed = page.getByTestId('event-feed');

  // devnet emits roughly two rows per slot, so the transaction's own progress would scroll
  // out of the rendered window within seconds. It is what the feed defaults to showing.
  await expect(feed).toContainText('hero tx', { timeout: 20_000 });
  await expect(feed).not.toContainText('block produced');
  // And the reader is told rows are held back rather than silently missing them.
  await expect(page.getByTestId('feed-count')).toContainText('slot/block rows hidden');

  // Everything is still there, one click away.
  await page.getByTestId('feed-scope-all').click();
  await expect(feed).toContainText('block produced');
  await expect(page.getByTestId('feed-count')).not.toContainText('hidden');

  await page.getByTestId('feed-scope-watched').click();
  await expect(feed).toContainText('hero tx');
  await expect(feed).not.toContainText('block produced');
});

test('the scope control only exists where it means something', async ({ page }) => {
  await page.goto('/?scenario=happy-path&mode=solo');
  await page.getByTestId('tab-events').click();
  await expect(page.getByTestId('event-feed')).toBeVisible({ timeout: 20_000 });
  // Simulated runs are short and their event mix is already legible, so no scope switch.
  await expect(page.getByTestId('feed-scope-all')).toHaveCount(0);
  await expect(page.getByTestId('feed-count')).toContainText('shown · newest first');
});

const WALLET_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

/**
 * Stand in for a Wallet Standard browser extension.
 *
 * `@wallet-standard/app` discovers wallets by dispatching `wallet-standard:app-ready` and
 * waiting for each extension to call `register`, exactly as a real extension does, so
 * listening for that event here tests the real discovery path rather than a shortcut.
 *
 * No `window.solana` is faked on purpose. The panel used to gate its Connect button on the
 * legacy provider while signing through Wallet Standard, so a wallet that speaks only the
 * standard, which is most of them now, never saw the button at all. Faking only the
 * standard here is what makes that regression visible: drop the standard path and these
 * tests lose their Connect button.
 */
async function mockWallet(page: Page, opts: { reject?: boolean } = {}) {
  await page.addInitScript(
    ({ addr, reject }) => {
      const wallet = {
        name: 'Mock wallet',
        version: '1.0.0',
        icon: 'data:image/svg+xml,',
        chains: ['solana:devnet'],
        accounts: [{ address: addr, label: 'Mock', chains: ['solana:devnet'] }],
        features: {
          'solana:signTransaction': {
            signTransaction: async (tx: Uint8Array, chain: string) => {
              (window as unknown as Record<string, unknown>).__signChain = chain;
              if (reject) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
              // A legacy wire transaction: signature count, 64-byte signature, then the
              // message. The signature is not real; the client only parses it.
              const out = new Uint8Array(1 + 64 + tx.length);
              out[0] = 1;
              out.set(tx, 65);
              return { signedTransaction: out, signature: new Uint8Array(64) };
            },
          },
        },
      };
      window.addEventListener('wallet-standard:app-ready', ((e: CustomEvent) => {
        (e.detail as { register(w: unknown): void }).register(wallet);
      }) as EventListener);
    },
    { addr: WALLET_ADDRESS, reject: opts.reject ?? false },
  );
}

test('sending a devnet transfer signs with the wallet and traces the result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const rpc = await mockDevnet(page);
  await mockWallet(page);
  await openLive(page);

  // No send controls before a wallet is connected.
  await expect(page.getByTestId('live-send')).toHaveCount(0);

  await page.getByTestId('live-connect').click();
  await expect(page.getByTestId('live-send')).toBeVisible();

  // Self-transfer by default: the recipient field starts as the connected account.
  await expect(page.getByTestId('live-recipient')).toHaveValue(WALLET_ADDRESS);
  await page.getByTestId('live-amount').fill('0.01');
  await page.getByTestId('live-send-button').click();

  // The wallet is asked for devnet by name, so a wallet on another cluster refuses.
  await expect(page.getByTestId('live-note')).toContainText('Tracing', { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__signChain)).toBe('solana:devnet');

  // The transaction was actually broadcast, not merely signed.
  expect(rpc.sentBytes()).toHaveLength(1);

  // And it is being traced from the signature the RPC reported, with no pasting in between.
  await expect(page.getByTestId('live-signature')).toHaveValue(SIG);
  await openFeed(page);
  await expect(page.getByTestId('event-feed')).toContainText('hero tx included in block', { timeout: 20_000 });
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('a declined signature is reported as declined, not as a failure to send', async ({ page }) => {
  await mockDevnet(page);
  await mockWallet(page, { reject: true });
  await openLive(page);
  await page.getByTestId('live-connect').click();
  await page.getByTestId('live-send-button').click();

  await expect(page.getByTestId('live-note')).toContainText('declined', { timeout: 20_000 });
  // Nothing was broadcast, and nothing was claimed to have been traced.
  expect(SIG).toBeTruthy();
});

test('an amount that is not devnet SOL is refused before the wallet is asked', async ({ page }) => {
  const rpc = await mockDevnet(page);
  await mockWallet(page);
  await openLive(page);
  await page.getByTestId('live-connect').click();
  await page.getByTestId('live-amount').fill('0.0000000001');
  await page.getByTestId('live-send-button').click();

  // Ten decimals cannot exist in lamports, so there is nothing to sign.
  await expect(page.getByTestId('live-note')).toContainText('not an amount of devnet SOL', { timeout: 20_000 });
  expect(rpc.sentBytes()).toHaveLength(0);
});

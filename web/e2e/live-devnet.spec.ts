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

  await page.route(
    (url) => url.hostname === 'api.devnet.solana.com',
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { method: string; params: unknown[] };
      let result: unknown = null;
      switch (body.method) {
        case 'getSlot':
          // devnet's tip moves between polls, which is the only way the client learns it
          // has new slots to look at. A frozen tip would mean an idle cluster.
          slotCalls += 1;
          result = (tip += 2);
          break;
        case 'getBlocks': {
          const [from, to] = body.params as [number, number];
          const blocks: (string | null)[] = [];
          for (let s = from; s <= to; s++) blocks.push(s % skipped === 0 ? null : `blk${s}`);
          result = blocks;
          break;
        }
        case 'getSignatureStatuses':
          // Walk the levels on successive polls, the way a real finalization does.
          level = level === 'processed' ? 'confirmed' : level === 'confirmed' ? 'finalized' : 'finalized';
          result = { value: [{ slot: 508_100_002, confirmationStatus: level, err: null }] };
          break;
        case 'getBlockTime':
          result = Math.floor(Date.now() / 1000) - 1;
          break;
        default:
          result = null;
      }
      await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
    },
  );
  return { slotCalls: () => slotCalls };
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
  await page.getByTestId('live-watch').click();
  // The full stream: the feed hides block and slot traffic by default so that the watched
  // transaction stays readable, and this test is about everything the RPC reports.
  await openFeed(page, 'all');

  // A live run starts running by itself: there is nothing to step through.
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

test('the commitment ladder fills from observed levels, not from the model', async ({ page }) => {
  await mockDevnet(page, { slots: 8 });
  await openLive(page);
  await page.getByTestId('live-signature').fill(SIG);
  await page.getByTestId('live-watch').click();

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
  await page.getByTestId('live-watch').click();
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
  await page.getByTestId('live-watch').click();
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

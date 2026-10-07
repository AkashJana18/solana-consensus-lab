import { expect, test } from '@playwright/test';

const MEASUREMENT_ID = 'G-MH02XQ9SP4';

/**
 * Google Analytics is a third-party script, so the only two things worth asserting are that
 * it is wired up and that its absence changes nothing. Nothing else in the app may depend
 * on it, which is the property these tests exist to hold.
 */
test('the GA4 tag loads and configures its measurement id', async ({ page }) => {
  const requested: string[] = [];
  await page.route('https://www.googletagmanager.com/**', (route) => {
    requested.push(route.request().url());
    // Fulfilled rather than continued: the real tag is never called in tests, so the suite
    // neither pings GA nor depends on the network.
    return route.fulfill({
      contentType: 'application/javascript',
      body: 'window.dataLayer = window.dataLayer || [];',
    });
  });

  await page.goto('/');

  expect(requested.some((u) => u.includes(`gtag/js?id=${MEASUREMENT_ID}`))).toBe(true);

  // The bootstrap queues before the tag arrives, which is what makes the call order safe.
  const queued = await page.evaluate(
    () => (window as unknown as { dataLayer: unknown[] }).dataLayer?.map((a) => Array.from(a as ArrayLike<unknown>)),
  );
  expect(queued, 'dataLayer must exist even if the tag never loads').toBeTruthy();
  expect(queued!.some((args) => args[0] === 'js')).toBe(true);
  expect(queued!.some((args) => args[0] === 'config' && args[1] === MEASUREMENT_ID)).toBe(true);
});

test('a blocked GA tag does not stop the simulation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // The realistic failure: an extension, a privacy setting or a firewall drops the request.
  await page.route('https://www.googletagmanager.com/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=happy-path&mode=alpenglow');

  await expect(page.locator('.canvas-caption .muted')).toContainText('slot', { timeout: 15_000 });
  await page.getByTestId('speed').selectOption('20');
  await page.getByTestId('play').click();

  // The point of the test: the app runs to completion regardless.
  await expect(page.getByTestId('stage-alpenglow-finalized')).toHaveAttribute('data-reached', 'true', {
    timeout: 20_000,
  });
  // And the failure surfaced nowhere as an application error. A blocked third-party request
  // logs a network failure in the console, which is the browser's business, not ours.
  const appErrors = errors.filter((e) => !/googletagmanager|net::ERR_FAILED|Failed to load resource/i.test(e));
  expect(appErrors, `app errors: ${appErrors.join('\n')}`).toEqual([]);
});
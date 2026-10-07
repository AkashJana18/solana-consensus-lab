import { expect, test } from '@playwright/test';

/**
 * GA4 is configured at build time, so these tests drive it the way production does: by setting
 * VITE_GA_ID before the dev server starts. The Playwright `webServer` block below does that,
 * and the default value below is a placeholder so no run can ever report to the real property.
 *
 * What is worth asserting is not "did GA load". It is that the real production id cannot
 * appear here at all, and that a blocked or slow tag stops nothing.
 */

const GA_ID = 'G-TESTID0000';
const TAG_HOST = 'https://www.googletagmanager.com/**';

test('the real production id is nowhere in the served app', async ({ page }) => {
  // This suite runs with a placeholder id (see playwright.config.ts), so the loaded document
  // must not reference the production property. That is what proves a CI run and a local
  // clone cannot report page views to real analytics, whatever the harness is configured with.
  await page.route(TAG_HOST, (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();
  await page.waitForTimeout(500);

  const html = await page.content();
  expect(html).not.toContain('G-MH02XQ9SP4');
  // The served module graph too, since a client-side import could carry it.
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src),
  );
  for (const src of scripts) {
    const body = await (await page.request.get(src)).text();
    expect(body, src).not.toContain('G-MH02XQ9SP4');
  }
});

test('the configured id is installed and queued before the tag loads', async ({ page }) => {
  const requested: string[] = [];
  await page.route(TAG_HOST, (route) => {
    requested.push(route.request().url());
    // Fulfilled, not continued: the suite neither calls GA nor needs the network.
    return route.fulfill({ contentType: 'application/javascript', body: '' });
  });

  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();

  await expect(page.locator(`script[src*="googletagmanager"][src*="${GA_ID}"]`)).toHaveCount(1, {
    timeout: 10_000,
  });
  expect(requested.some((u) => u.includes(GA_ID))).toBe(true);

  const queued = await page.evaluate(
    () => (window as unknown as { dataLayer?: unknown[] }).dataLayer?.map((a) => Array.from(a as ArrayLike<unknown>)),
  );
  expect(queued?.some((a) => a[0] === 'js')).toBe(true);
  expect(queued?.some((a) => a[0] === 'config' && a[1] === GA_ID)).toBe(true);
});

test('a blocked tag does not stop the simulation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // The realistic failure: an extension, a privacy setting or a firewall drops the request.
  await page.route(TAG_HOST, (route) => route.abort('failed'));
  await page.goto('/?scenario=happy-path&mode=alpenglow');

  await expect(page.locator('.canvas-caption .muted')).toContainText('slot', { timeout: 15_000 });
  await page.getByTestId('speed').selectOption('20');
  await page.getByTestId('play').click();

  // The point of the test: the app runs to completion regardless.
  await expect(page.getByTestId('stage-alpenglow-finalized')).toHaveAttribute('data-reached', 'true', {
    timeout: 20_000,
  });
  // A blocked third-party request is the browser's problem to log, not an application error.
  const appErrors = errors.filter((e) => !/googletagmanager|net::ERR_FAILED|Failed to load resource/i.test(e));
  expect(appErrors, `app errors: ${appErrors.join('\n')}`).toEqual([]);
});

test('only one tag is installed, so page views cannot be counted twice', async ({ page }) => {
  await page.route(TAG_HOST, (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();
  await expect(page.locator(`script[src*="${GA_ID}"]`)).toHaveCount(1, { timeout: 10_000 });

  // A client-side navigation and a reload are the two things that could reinstall it.
  await page.getByTestId('lessons-open').click();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('scenario-select')).toBeVisible();

  // One per document load, which is correct: a reload is a genuinely new page view.
  await expect(page.locator(`script[src*="${GA_ID}"]`)).toHaveCount(1, { timeout: 10_000 });
});

import { expect, test } from '@playwright/test';

/** The repo the source link points at, and the key its count is cached under. */
const REPO_URL = 'https://github.com/AkashJana18/solana-consensus-lab';
const STARS_KEY = 'scl.stars';

test('the source link points at the repo and is the last tab stop in the bar', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  const link = page.getByTestId('repo-link');
  await expect(link).toHaveAttribute('href', REPO_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  // noreferrer covers noopener, and keeps the repo URL out of the opener.
  await expect(link).toHaveAttribute('rel', 'noreferrer');
  // The count arrives from the network, so assert the shape of the name and never its value.
  await expect(link).toHaveAccessibleName(/^Solana Consensus Lab on GitHub(, \d+ stars?)?$/);

  // It is a real <a>, not a button with a click handler: it is in the tab order, it is the
  // last stop in the bar, and it carries the focus ring every other control does.
  await page.getByTestId('speed').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('repo-link');
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return `${cs.outlineStyle} ${cs.outlineWidth}`;
  });
  expect(ring, 'the source link has no 2px focus ring').toBe('solid 2px');
});

test('the link survives every width and only the count gives way', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  // The mark is the link; the number is only the news, so the count is what collapses (at
  // 1200px, where the wordmark rule below has the least slack to give). See the note by the
  // 1520px rule in global.css for the measurements behind these thresholds.
  for (const [width, stars] of [
    [1440, true],
    [1280, true],
    [1201, true],
    [1200, false],
    [1024, false],
    [390, false],
  ] as [number, boolean][]) {
    await page.setViewportSize({ width, height: 900 });
    const link = page.getByTestId('repo-link');
    await expect(link).toBeVisible();
    await expect(link.locator('.repo-mark')).toBeVisible();
    expect(await link.locator('.repo-stars').isVisible(), `the star count should ${stars ? '' : 'not '}show at ${width}px`).toBe(stars);
  }
});

test('the count comes from cache, and automation never spends the quota', async ({ page }) => {
  // Seed a cached count and reload: it has to render without any network, which is what
  // keeps the number stable across reloads instead of flickering with every page load.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STARS_KEY, JSON.stringify({ n: 1234, retryAt: Date.now() + 3_600_000 })] as [string, string],
  );
  const github: string[] = [];
  page.on('request', (r) => r.url().includes('api.github.com') && github.push(r.url()));

  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  await expect(page.getByTestId('repo-stars')).toHaveText('1234');
  await expect(page.getByTestId('repo-link')).toHaveAccessibleName('Solana Consensus Lab on GitHub, 1234 stars');
  expect(github, 'the suite must not call the GitHub API, whose anonymous quota is shared').toEqual([]);
});

test('a visitor with no cache fetches once, then reads the cache', async ({ page }) => {
  // Stand in for a real browser twice over: the app skips the request under automation, so
  // flip the flag the way a real browser has it, and answer the API from a route instead of
  // spending the shared anonymous quota. This is the only coverage of the success path.
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  let calls = 0;
  await page.route('**/api.github.com/**', (route) => {
    calls += 1;
    route.fulfill({ json: { stargazers_count: 7 }, headers: { 'access-control-allow-origin': '*' } });
  });

  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
  await expect(page.getByTestId('repo-stars')).toHaveText('7');
  await expect(page.getByTestId('repo-link')).toHaveAccessibleName('Solana Consensus Lab on GitHub, 7 stars');
  const afterFirstLoad = calls;
  expect(afterFirstLoad, 'the count was never fetched').toBeGreaterThan(0);

  // The count is good for an hour, so a reload renders it without asking again. Compared as
  // a delta, not a total: StrictMode double-invokes the effect in dev, so the first load
  // asks more than once.
  await page.reload();
  await expect(page.getByTestId('repo-stars')).toHaveText('7');
  expect(calls, 'the cached count should have been reused').toBe(afterFirstLoad);
});

test('a rate-limited visitor gets the mark, not a broken chip', async ({ page }) => {
  // No cache and no usable API: the state of someone behind an office NAT that has spent
  // the hourly anonymous quota. The chip still renders and still links. The route aborts
  // the API too, so this holds even if the automation guard in useStarCount is removed.
  await page.route('**/api.github.com/**', (route) => route.abort());
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  const link = page.getByTestId('repo-link');
  await expect(link.locator('.repo-mark')).toBeVisible();
  await expect(page.getByTestId('repo-stars')).toHaveText('');
  await expect(link).toHaveAccessibleName('Solana Consensus Lab on GitHub');
  await expect(link).toHaveAttribute('href', REPO_URL);
});
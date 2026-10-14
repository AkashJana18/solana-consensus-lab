import { expect, test } from '@playwright/test';

// Everything here is about the bytes a crawler receives, so these run with JavaScript
// switched off. That is the only honest way to assert on them: a test that lets the bundle
// boot would be checking the app's DOM, which is exactly what the prerendered shell exists
// to stand in front of, and would pass even if the shell were empty.
//
// The generated guides live in web/public, which the dev server serves, so these hit real
// HTTP responses rather than reading files off disk.

const ORIGIN = 'https://www.solanaconsensuslab.com';
const GUIDES = [
  '/tower-vs-alpenglow.html',
  '/lessons.html',
  '/lessons/one-tx.html',
  '/lessons/votes-cost.html',
  '/lessons/skip-certs.html',
  '/lessons/lockouts.html',
  '/lessons/twenty-twenty.html',
  '/protocols.html',
];

test.use({ javaScriptEnabled: false });

test.describe('prerendered shell', () => {
  test('the landing page states its subject before any script runs', async ({ page }) => {
    await page.goto('/');

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText('Solana Consensus Lab');

    // The headline claim, in the form the rest of the site uses it.
    await expect(page.locator('.boot')).toContainText('12.8 seconds');
    await expect(page.locator('.boot')).toContainText('150 milliseconds');

    // Internal links are the only way a crawler moves from this page to the guides.
    for (const href of ['./tower-vs-alpenglow.html', './lessons.html', './protocols.html']) {
      await expect(page.locator(`.boot a[href="${href}"]`)).toHaveCount(1);
    }
  });

  test('says plainly that the simulator needs JavaScript', async ({ page }) => {
    // Nothing in the shell may be time-dependent: with scripting off, every word on the page
    // has to stay true.
    await page.goto('/');
    await expect(page.locator('.boot')).not.toContainText(/loading/i);
    await expect(page.getByText(/needs JavaScript and WebAssembly/)).toBeVisible();
  });

  test('is replaced by the app once React mounts', async ({ browser }) => {
    // The counterpart to the checks above. React 18's createRoot().render() destroys the
    // container's existing children on its first commit, so the shell must not survive into
    // the running app or it would sit underneath the canvas for the whole session.
    const ctx = await browser.newContext({ javaScriptEnabled: true });
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      await expect(page.getByTestId('scenario-select')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.boot')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('generated guides', () => {
  for (const path of GUIDES) {
    test(`${path} is served with a title, description, canonical and heading`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const html = await res.text();

      expect(html, path).toMatch(new RegExp(`<title>[^<]{10,}</title>`));
      expect(html, path).toMatch(/<meta name="description" content="[^"]{50,}"/);
      expect(html, path).toContain(`<link rel="canonical" href="${ORIGIN}${path}" />`);
      expect(html, path).toContain('<h1>');
      expect(html, path).toContain('<script type="application/ld+json">');
    });
  }

  test('every cross-link between them resolves', async ({ request }) => {
    for (const from of GUIDES) {
      const html = await (await request.get(from)).text();
      const depth = from.split('/').length - 2;
      const prefix = depth === 0 ? './' : '../'.repeat(depth);
      const hrefs = [...html.matchAll(/href="([^"#?]+\.html)"/g)].map((m) => m[1]);

      expect(hrefs.length, `${from} has no cross-links`).toBeGreaterThan(0);
      for (const href of hrefs) {
        // Relative by necessity: the same dist has to work from a GitHub Pages sub-path.
        expect(href, `${from} -> ${href}`).not.toMatch(/^\//);
        const target = new URL(href.replace(prefix, '/'), ORIGIN).pathname;
        const res = await request.get(target);
        expect(res.status(), `${from} -> ${href} (${target})`).toBe(200);
      }
    }
  });

  test('the protocol reference renders its tables rather than raw pipes', async ({ page }) => {
    await page.goto('/protocols.html');
    await expect(page.getByRole('columnheader', { name: 'Certificate' })).toBeVisible();
    await expect(page.locator('table')).toHaveCount(3);
  });

  test('a lesson page carries its prose with scripting off', async ({ page }) => {
    await page.goto('/lessons/one-tx.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('One transaction, two protocols');
    await expect(page.locator('main')).toContainText('TowerBFT');
    // The questions are the searchable part of a lesson, so they have to be in the HTML.
    await expect(page.locator('.qa')).not.toHaveCount(0);
  });

  test('the comparison page states the measured numbers', async ({ page }) => {
    await page.goto('/tower-vs-alpenglow.html');
    await expect(page.locator('main')).toContainText('451 ms');
    await expect(page.locator('main')).toContainText('150 ms');
  });
});

test.describe('crawl entry points', () => {
  test('robots.txt is served and points at the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    // Query strings are the same document as "/" and are declared canonical there.
    expect(body).toContain('Disallow: /*?*');
  });

  test('the sitemap lists the app and every guide, all reachable', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();

    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(GUIDES.length + 1);
    expect(new Set(locs).size, 'duplicate sitemap entries').toBe(locs.length);
    expect(locs).toContain(`${ORIGIN}/`);

    for (const loc of locs) {
      const path = new URL(loc).pathname;
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});
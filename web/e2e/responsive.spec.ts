import { expect, test, type Page } from '@playwright/test';

/** Every direct child of the top bar must stay inside the bar's right padding edge. */
async function topBarOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    if (!bar) throw new Error('no .topbar');
    const barRight = bar.getBoundingClientRect().right;
    return Math.max(0, ...[...bar.children].map((c) => Math.round(c.getBoundingClientRect().right - barRight)));
  });
}

/** The labels collapse well below this, so the bar must never need more than the viewport. */
const WIDTHS = [1440, 1366, 1280, 1024];

test('the top bar fits laptop widths without clipping the readout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?scenario=happy-path');
    await expect(page.getByTestId('scenario-select')).toHaveValue('happy-path');
    await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

    expect(await topBarOverflow(page), `a top bar control is clipped at ${width}px`).toBe(0);
    const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(scroll.doc, `the document scrolls sideways at ${width}px`).toBeLessThanOrEqual(scroll.inner);
    // The readout is the last thing in the bar and the easiest thing to lose.
    await expect(page.getByTestId('readout')).toBeInViewport();
  }

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('the inspector fits its column and every tab stays reachable', async ({ page }) => {
  for (const width of [1440, 1200, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    // ?tab=metrics is the widest tab, and it arrives here without a click.
    await page.goto('/?scenario=happy-path&mode=compare&tab=metrics');
    await expect(page.getByTestId('scenario-select')).toHaveValue('happy-path');
    await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

    // The document must not scroll sideways: a fixed grid column cannot push it.
    const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(scroll.doc, `the document scrolls sideways at ${width}px`).toBeLessThanOrEqual(scroll.inner);

    // The inspector column stays inside the viewport...
    const box = await page.locator('.inspector').boundingBox();
    expect(box!.x + box!.width, `the inspector runs past the viewport at ${width}px`).toBeLessThanOrEqual(width);

    // ...and the selected tab is scrolled into view, not just reachable by scrolling.
    await expect(page.getByTestId('tab-metrics')).toBeInViewport();
    await expect(page.getByTestId('tab-metrics')).toHaveAttribute('aria-selected', 'true');

    // Every tab can still be clicked, including the last one.
    for (const tab of ['transaction', 'votor', 'tower', 'events', 'metrics']) {
      const t = page.getByTestId(`tab-${tab}`);
      await t.click();
      await expect(t).toHaveAttribute('aria-selected', 'true');
    }
  }
});

test('the events feed fills its panel and scrolls itself', async ({ page }) => {
  // Single mode renders an <h3> header, compare mode a segmented control of a different
  // height. The feed must fit both without the panel growing a second scrollbar.
  for (const mode of ['alpenglow', 'compare']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?scenario=happy-path&mode=${mode}&tab=events&speed=20`);
    await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
    await page.getByTestId('play').click();
    await expect(page.getByTestId('event-feed')).toContainText('ms', { timeout: 20_000 });

    const geo = await page.evaluate(() => {
      const feed = document.querySelector('.feed') as HTMLElement;
      const panel = document.querySelector('.panel') as HTMLElement;
      return {
        feed: Math.round(feed.getBoundingClientRect().height),
        panelOverflows: panel.scrollHeight > panel.clientHeight + 1,
        rows: document.querySelectorAll('.feed-row').length,
        spacer: Math.round((feed.firstElementChild as HTMLElement).getBoundingClientRect().height),
      };
    });
    // The panel does not scroll: the feed does, inside its 1fr track.
    expect(geo.panelOverflows, `the inspector panel scrolls in ${mode} mode`).toBe(false);
    // Virtualisation is live: many events, a screenful of rows, a tall scroll spacer.
    expect(geo.rows).toBeGreaterThan(4);
    expect(geo.spacer).toBeGreaterThan(geo.feed * 2);
  }
});

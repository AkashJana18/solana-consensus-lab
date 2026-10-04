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

test('the app stays usable below 1024px instead of clipping', async ({ page }) => {
  // The app used to declare min-width: 1024px while body has overflow: hidden, so a
  // narrower window simply cut the inspector off with no way to scroll to it.
  for (const [width, height, mode] of [
    [1024, 768, 'alpenglow'],
    [900, 800, 'compare'],
    [768, 1024, 'compare'],
    [390, 844, 'alpenglow'],
  ] as [number, number, string][]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/?scenario=happy-path&mode=${mode}&tab=transaction`);
    await expect(page.getByTestId('scenario-select')).toHaveValue('happy-path');
    await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 20_000 });

    const geo = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      canvases: [...document.querySelectorAll('.canvas-host')].map((h) => ({
        host: h.clientWidth,
        canvas: Math.round(h.querySelector('canvas')!.getBoundingClientRect().width),
      })),
    }));
    expect(geo.doc, `the document scrolls sideways at ${width}px`).toBeLessThanOrEqual(geo.inner);
    expect(geo.canvases.length, `no canvas mounted at ${width}px`).toBeGreaterThan(0);
    for (const c of geo.canvases) expect(c.canvas, `a canvas does not fill its host at ${width}px`).toBe(c.host);

    // The inspector, its tabs and the timeline are all still reachable.
    await expect(page.locator('.inspector')).toBeInViewport();
    await expect(page.getByTestId('timeline')).toBeInViewport();
    await page.getByTestId('tab-metrics').click();
    await expect(page.getByTestId('tab-metrics')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('node-picker').selectOption('3');
    await expect(page.getByTestId('node-picker')).toHaveValue('3');
  }
});

test('the product name stays in the top bar until the bar cannot hold it', async ({ page }) => {
  // The control labels collapse at 1400px, but the product name is not one of them: it is
  // the one label worth keeping, and hiding it is what made the bar look anonymous.
  for (const [width, visible] of [
    [1440, true],
    [1366, true],
    [1280, true],
    [1200, true],
    [1100, true],
    [1099, false],
    [1024, false],
  ] as [number, boolean][]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?scenario=happy-path');
    await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

    const name = page.locator('.brand span:not(.brand-mark)');
    await expect(name).toHaveText('Solana Consensus Lab');
    // The mark is an inline SVG and is always there; only the wordmark is conditional.
    await expect(page.locator('.brand-mark svg')).toBeVisible();
    await expect(page.locator('.brand-mark svg')).toHaveCSS('height', '24px');
    expect(await name.isVisible(), `the product name should ${visible ? '' : 'not '}show at ${width}px`).toBe(visible);

    // With the name showing the bar needs 1070px in the worst case (20s scenario, 20x
    // speed, compare), so the document must never scroll. See the note by the 1099px rule
    // in global.css for how to re-measure it after changing the bar.
    const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(scroll.doc, `the document scrolls sideways at ${width}px`).toBeLessThanOrEqual(scroll.inner);
    // The clock is the right-most thing in the bar, so it is the first to be lost.
    await expect(page.getByTestId('readout')).toBeInViewport();
  }
});

test('the tab has an icon, and the mark is drawn at a legible size', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  // Vite rewrites the href per base: './favicon.svg' in the build (for the GitHub Pages
  // sub-path) and '/favicon.svg' under the dev server, so match the filename and fetch it.
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(icon).toMatch(/\.?\/?favicon\.svg$/);
  expect((await page.request.get(icon!)).status()).toBe(200);

  // The mark is two paths: the gradient bars, and the white "CL" knockout on top. It has to
  // survive being the only thing left in the bar at 390px.
  const shapes = page.locator('.brand-mark svg path');
  await expect(shapes).toHaveCount(2);
  for (const w of [1440, 1100, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await expect(page.locator('.brand-mark svg')).toBeVisible();
    await expect(shapes).toHaveCount(2);
  }
  const mark = await page.evaluate(() => {
    const svg = document.querySelector('.brand-mark svg')!;
    const grad = svg.querySelector('linearGradient')!;
    return {
      gradId: grad.id,
      fill: svg.querySelector('path')!.getAttribute('fill'),
      stops: [...grad.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')),
      offsets: [...grad.querySelectorAll('stop')].map((s) => s.getAttribute('offset')),
      viewBox: svg.getAttribute('viewBox'),
      fills: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('fill')),
      // Measured, not read off an attribute: the browser derives the width from the
      // viewBox, so this is the ratio that actually renders.
      box: (() => { const b = svg.getBoundingClientRect(); return { w: b.width, h: b.height }; })(),
    };
  });
  // Traced from the supplied PNG, so these are the values that were measured out of it:
  // the viewBox is cropped to the ink and the gradient is the sampled ramp, green at the top
  // through to purple at the bottom.
  expect(mark.viewBox).toBe('93.8 180.7 811.4 637.6');
  expect(mark.fills).toEqual([`url(#${mark.gradId})`, '#FFFFFF']);
  expect(mark.stops[0]).toBe('#58C0A1');
  expect(mark.stops[mark.stops.length - 1]).toBe('#8357A4');
  expect(mark.stops.length).toBe(9);
  expect(mark.box.h).toBeCloseTo(24, 1);
  expect(mark.box.w / mark.box.h).toBeCloseTo(811.4 / 637.6, 2);
});

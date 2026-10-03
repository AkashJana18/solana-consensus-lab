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

import { expect, test, type Page } from '@playwright/test';

interface CanvasSize {
  host: number;
  canvas: number;
  ok: boolean;
}

/** Each canvas must exactly fill its host, else the scene is laid out wider than the visible bitmap. */
async function canvasSizes(page: Page): Promise<CanvasSize[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.canvas-host')].map((h) => {
      const c = h.querySelector('canvas');
      const canvas = c ? Math.round(c.getBoundingClientRect().width) : -1;
      const host = h.clientWidth;
      return { host, canvas, ok: host > 0 && host === canvas };
    }),
  );
}

/** Waits for `count` canvases to be mounted and each to match its host width. */
async function expectCanvasesFit(page: Page, count: number): Promise<void> {
  const any = { host: expect.any(Number), canvas: expect.any(Number) };
  await expect
    .poll(() => canvasSizes(page), { timeout: 15_000, message: 'canvases never matched their host width' })
    .toEqual(Array.from({ length: count }, () => ({ ...any, ok: true })));
}

test('canvases track their host when the layout changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();
  // Workers have handed back meta, so the scenes are laid out rather than empty.
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
  await expectCanvasesFit(page, 1);

  // one-tx runs in compare mode, so the lesson takes over from the default alpenglow:
  // the panel steals a grid column and the second canvas appears.
  await page.getByTestId('lessons-open').click();
  await page.getByTestId('lesson-pick-one-tx').click();
  await expect(page.getByTestId('lesson-panel')).toBeVisible();
  await expect(page.getByTestId('mode-compare')).toHaveAttribute('aria-checked', 'true');
  await expectCanvasesFit(page, 2);

  // Exiting gives the column back *and* restores the mode the lesson replaced.
  await page.getByTestId('lesson-exit').click();
  await expect(page.getByTestId('lesson-panel')).toHaveCount(0);
  await expect(page.getByTestId('mode-alpenglow')).toHaveAttribute('aria-checked', 'true');
  await expectCanvasesFit(page, 1);

  // Switching mode halves (or doubles) the canvas that stays mounted.
  await page.getByTestId('mode-compare').click();
  await expectCanvasesFit(page, 2);
  await page.getByTestId('mode-alpenglow').click();
  await expectCanvasesFit(page, 1);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

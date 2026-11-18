import { expect, test } from '@playwright/test';

/** Drags the pane by its header, from the middle of the text block. */
async function dragBy(page: import('@playwright/test').Page, dx: number, dy: number): Promise<void> {
  const head = page.getByTestId('lesson-panel').locator('.lesson-head');
  const box = (await head.boundingBox())!;
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('the lesson pane floats over the canvases and remembers where it was parked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
  const before = (await page.locator('.canvases').boundingBox())!;

  await page.getByTestId('lessons-open').click();
  await page.getByTestId('lesson-pick-one-tx').click();
  const panel = page.getByTestId('lesson-panel');
  await expect(panel).toBeVisible();

  // Floating, not a column: the canvases keep their width and the pane sits on top of them.
  const after = (await page.locator('.canvases').boundingBox())!;
  expect(Math.round(after.width), 'the lesson pane took a column from the canvases').toBe(Math.round(before.width));
  const start = (await panel.boundingBox())!;
  expect(start.x).toBeGreaterThanOrEqual(after.x - 1);
  expect(start.x + start.width).toBeLessThanOrEqual(after.x + after.width + 1);
  expect(start.y).toBeGreaterThanOrEqual(after.y - 1);
  expect(start.y + start.height).toBeLessThanOrEqual(900);

  await dragBy(page, 120, 90);
  const moved = (await panel.boundingBox())!;
  expect(Math.round(moved.x - start.x), 'the pane did not follow the pointer horizontally').toBeGreaterThan(80);
  expect(Math.round(moved.y - start.y), 'the pane did not follow the pointer vertically').toBeGreaterThan(50);

  // The lesson is in the URL, so a reload reopens it; it must reopen where it was left.
  await page.reload();
  await expect(page.getByTestId('lesson-panel')).toBeVisible();
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
  const restored = (await page.getByTestId('lesson-panel').boundingBox())!;
  expect(Math.abs(restored.x - moved.x), 'the remembered x did not survive a reload').toBeLessThan(2);
  expect(Math.abs(restored.y - moved.y), 'the remembered y did not survive a reload').toBeLessThan(2);

  // Exiting still tears it down.
  await page.getByTestId('lesson-exit').click();
  await expect(page.getByTestId('lesson-panel')).toHaveCount(0);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('below 1024px the pane is a full-width sheet that still moves vertically', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/?lesson=one-tx');

  const panel = page.getByTestId('lesson-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  const start = (await panel.boundingBox())!;
  expect(Math.round(start.x), 'the sheet is not flush with the left gutter').toBe(12);
  expect(Math.round(start.width), 'the sheet is not full width').toBe(900 - 24);
  expect(Math.round(800 - (start.y + start.height)), 'the sheet is not docked to the bottom').toBe(12);

  // Dragging diagonally only moves it vertically, and it stays full width.
  await dragBy(page, 200, -160);
  const moved = (await panel.boundingBox())!;
  expect(Math.round(moved.x), 'the sheet moved sideways').toBe(12);
  expect(Math.round(moved.width), 'the sheet stopped being full width').toBe(900 - 24);
  expect(moved.y, 'the sheet did not move up').toBeLessThan(start.y - 100);

  // It is still inside the viewport, and the document does not scroll sideways.
  const doc = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(doc).toBeLessThanOrEqual(900);
});

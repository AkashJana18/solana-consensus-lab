import { expect, test } from '@playwright/test';

test('compare mode finalizes under both protocols on leader-down', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await page.getByTestId('scenario-select').selectOption('leader-down');
  await page.getByTestId('mode-compare').click();
  await page.getByTestId('speed').selectOption('20');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
  await page.getByTestId('play').click();

  // Alpenglow finalizes shortly after the skipped window; Tower needs ~13 s of sim time to root.
  await expect(page.getByTestId('stage-alpenglow-finalized')).toHaveAttribute('data-reached', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('stage-tower-finalized')).toHaveAttribute('data-reached', 'true', { timeout: 60_000 });
  await page.screenshot({ path: 'e2e/screenshots/compare-leader-down.png', fullPage: false });
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

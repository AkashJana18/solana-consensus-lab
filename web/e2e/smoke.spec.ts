import { expect, test } from '@playwright/test';

test('happy-path finalizes under Alpenglow at 20x', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();
  await page.getByTestId('scenario-select').selectOption('happy-path');
  await page.getByTestId('mode-alpenglow').click();
  await page.getByTestId('speed').selectOption('20');

  // Wait for the worker to hand back meta (canvas caption shows the slot readout).
  await expect(page.locator('.canvas-caption .muted')).toContainText('slot', { timeout: 15_000 });
  await page.getByTestId('play').click();

  const finalized = page.getByTestId('stage-alpenglow-finalized');
  await expect(finalized).toHaveAttribute('data-reached', 'true', { timeout: 20_000 });
  await expect(finalized).toContainText('ms');
  const text = (await finalized.textContent()) ?? '';
  const ms = Number.parseFloat(text.replace(/,/g, ''));
  expect(ms).toBeGreaterThan(0);

  // Let the run finish so the screenshot shows the full timeline, then capture it.
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play', { timeout: 20_000 });
  await page.screenshot({ path: 'e2e/screenshots/happy-path.png', fullPage: false });

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

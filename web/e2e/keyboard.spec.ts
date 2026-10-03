import { expect, test } from '@playwright/test';

test('Space on a focused control presses it instead of starting playback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  // Space on the focused "step event" button used to start playback instead of pressing it.
  await page.getByTestId('step-event').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');

  // Space on a focused text field must type, not toggle.
  await page.getByLabel('Seed').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
  await page.getByLabel('Seed').blur();

  // With nothing focused, Space is still the transport shortcut.
  await page.locator('.brand-mark').click();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Pause');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

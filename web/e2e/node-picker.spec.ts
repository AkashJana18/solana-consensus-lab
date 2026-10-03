import { expect, test } from '@playwright/test';

test('a validator can be picked without a pointer, and the canvas names itself', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?scenario=happy-path&mode=compare');
  await expect(page.getByTestId('scenario-select')).toHaveValue('happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  // The canvas is an image to assistive tech, and says what it is showing.
  const canvas = page.locator('canvas[data-protocol="alpenglow"]');
  await expect(canvas).toHaveAttribute('role', 'img');
  await expect(canvas).toHaveAttribute('aria-label', /Alpenglow network: slot \d+, leader \d+, 25 validators/);
  await expect(canvas).toHaveAttribute('aria-label', /hero tx in slot \d+|no node selected|node \d+ selected/);

  // The picker lists every validator with its stake share.
  const picker = page.getByTestId('node-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option')).toHaveCount(26); // 25 validators + "none"

  // Keyboard-only selection: the Votor panel follows the picker.
  await page.getByTestId('tab-votor').click();
  await picker.selectOption('7');
  await expect(page.getByRole('heading', { name: /Node 7 · Votor flags/ })).toBeVisible();
  await expect(canvas).toHaveAttribute('aria-label', /node 7 selected/);

  // ...and so does the Tower panel in tower mode.
  await page.getByTestId('mode-tower').click();
  await page.getByTestId('tab-tower').click();
  await expect(page.getByRole('heading', { name: /Node 7 · lockout tower/ })).toBeVisible();

  // "none" clears the selection (checked in alpenglow mode, where its canvas is mounted).
  await page.getByTestId('mode-alpenglow').click();
  await picker.selectOption('');
  await expect(canvas).toHaveAttribute('aria-label', /no node selected/);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

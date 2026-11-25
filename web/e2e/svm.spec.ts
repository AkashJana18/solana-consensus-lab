import { expect, test } from '@playwright/test';

// The SVM lab is a second Vite entry. These specs are the only guard on the wasm
// bridge from the browser side, and they run with no mocks: the real svm-core wasm
// executes the counter program.

test('the SVM lab boots and every chapter renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/svm/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('no blockchain in memory');

  // Chapter 1 reads the layout out of wasm, so a visible region base proves the bridge.
  await expect(page.locator('.mem-region').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.mem-region-base').first()).toContainText('0x');

  // Aligned mode refuses an unaligned probe, Unaligned accepts it.
  await page.getByRole('button', { name: 'Aligned', exact: true }).click();
  await page.locator('.mem-nudge button', { hasText: '+3' }).click();
  await expect(page.locator('.mem-result.bad')).toBeVisible();
  await page.getByRole('button', { name: 'Unaligned' }).click();
  await expect(page.locator('.mem-result.bad')).toHaveCount(0);

  await page.getByRole('button', { name: /From Rust to a program account/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('fork exists to hit a target');
  await expect(page.locator('.check-list li')).toHaveCount(10);

  await page.getByRole('button', { name: /Inside the sandbox/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('CU is the wall');

  // The trace arrives from wasm. Play to the end and read the commit banner.
  await expect(page.locator('.ex-insns li')).toHaveCount(7, { timeout: 15_000 });
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.ex-result b')).toHaveText('Committed');
  await expect(page.locator('.ex-commit')).toContainText('29 00  00 00  00 00  00 00');
  await expect(page.locator('.ex-commit')).toContainText('2a 00  00 00  00 00  00 00');

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('a failing program rolls back and explains why', async ({ page }) => {
  await page.goto('/svm/?ch=execute');
  await expect(page.locator('.ex-select select')).toBeVisible({ timeout: 15_000 });
  await page.locator('.ex-select select').selectOption('readonly-write');
  await expect(page.locator('.ex-result b')).toHaveText('Running', { timeout: 15_000 });
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.ex-result b')).toHaveText('read-only-account');
  // The rejected write never touched the input buffer, so the counter still reads 41.
  await expect(page.locator('.ex-account').first().locator('code')).toContainText('29 00');
  await expect(page.locator('.ex-commit')).toContainText('restores every account');
});

test('the chapter is in the URL, so a share link lands on it', async ({ page }) => {
  await page.goto('/svm/?ch=build');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('fork exists to hit a target');
  await page.getByRole('button', { name: /Where the blockchain lives/ }).click();
  await expect(page).toHaveURL(/\?ch=memory$/);
});

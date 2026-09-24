import { expect, test } from '@playwright/test';

test('a share link restores scenario, mode, seed, time, node and tab, and Share copies it back', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/?scenario=leader-down&mode=compare&seed=3&t=2500&node=4&tab=events&speed=5');
  await expect(page.getByTestId('scenario-select')).toHaveValue('leader-down');
  await expect(page.getByTestId('mode-compare')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Seed')).toHaveValue('3');
  await expect(page.getByTestId('speed')).toHaveValue('5');
  await expect(page.getByTestId('tab-events')).toHaveClass(/on/);
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
  await expect(page.getByTestId('readout')).toContainText('2500.0', { timeout: 15_000 });
  // The Events feed (virtualised, newest first) has caught up to the restored time.
  await expect(page.getByTestId('event-feed')).toContainText('2,500.0 ms', { timeout: 15_000 });

  // The address bar mirrors the state without rewriting the incoming time.
  await expect(page).toHaveURL(/scenario=leader-down/);
  await expect(page).toHaveURL(/t=2500/);
  await expect(page).toHaveURL(/node=4/);

  await page.getByTestId('share').click();
  await expect(page.getByTestId('share-toast')).toContainText('Link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('scenario=leader-down');
  expect(copied).toContain('mode=compare');
  expect(copied).toContain('seed=3');
  expect(copied).toContain('t=2500');
  expect(copied).toContain('node=4');
  expect(copied).toContain('tab=events');

  // A bad scenario name degrades to a notice, not a crash.
  await page.goto('/?scenario=does-not-exist');
  await expect(page.getByRole('status')).toContainText('Unknown scenario');
  await expect(page.getByTestId('scenario-select')).toHaveValue('happy-path');

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

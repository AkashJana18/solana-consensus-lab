import { expect, test } from '@playwright/test';

test('the Skip certificates lesson runs end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByTestId('scenario-select')).toBeVisible();
  await page.getByTestId('lessons-open').click();
  await page.getByTestId('lesson-pick-skip-certs').click();

  // The lesson swaps the scenario to leader-down in Alpenglow mode and opens on the intro.
  const panel = page.getByTestId('lesson-panel');
  await expect(panel).toHaveAttribute('data-step', '-1');
  await expect(page.getByTestId('scenario-select')).toHaveValue('leader-down');
  await expect(page.getByTestId('mode-alpenglow')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.canvas-caption .muted')).toContainText('slot', { timeout: 15_000 });

  // Step 1 has no question: it runs as soon as it is entered and stops on node_offline.
  await page.getByTestId('lesson-next').click();
  await expect(panel).toHaveAttribute('data-step', '0');
  await expect(panel).toHaveAttribute('data-phase', 'reveal', { timeout: 20_000 });
  await expect(page.getByTestId('lesson-step-0')).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('readout')).toContainText('1000.0');

  // Step 2: predict, run, reveal. The right answer is the Skip-certificate one.
  await page.getByTestId('lesson-next').click();
  await expect(panel).toHaveAttribute('data-phase', 'predict');
  await expect(page.getByTestId('lesson-run')).toBeDisabled();
  await page.getByTestId('lesson-choice-1').click();
  await page.getByTestId('lesson-run').click();
  await expect(panel).toHaveAttribute('data-phase', 'reveal', { timeout: 20_000 });
  await expect(page.getByTestId('lesson-answer')).toHaveAttribute('data-correct', 'true');
  await expect(page.getByTestId('tab-votor')).toHaveClass(/on/);
  await expect(page.getByTestId('lesson-step-0')).toHaveAttribute('data-state', 'done');

  // Remaining steps auto-run to their stops.
  for (const step of [2, 3, 4]) {
    await page.getByTestId('lesson-next').click();
    await expect(panel).toHaveAttribute('data-step', String(step));
    await expect(panel).toHaveAttribute('data-phase', 'reveal', { timeout: 30_000 });
  }
  await expect(page.getByTestId('stage-alpenglow-finalized')).toHaveAttribute('data-reached', 'true');

  // Back returns to a recorded stop without re-running.
  await page.getByTestId('lesson-back').click();
  await expect(panel).toHaveAttribute('data-step', '3');
  await expect(panel).toHaveAttribute('data-phase', 'reveal');
  await page.getByTestId('lesson-next').click();
  await expect(panel).toHaveAttribute('data-phase', 'reveal');

  // Outro, then finish.
  await page.getByTestId('lesson-next').click();
  await expect(panel).toHaveAttribute('data-step', '5');
  await expect(page).toHaveURL(/lesson=skip-certs/);
  await page.getByTestId('lesson-finish').click();
  await expect(panel).toHaveCount(0);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

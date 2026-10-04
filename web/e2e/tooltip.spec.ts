import { expect, test } from '@playwright/test';

const tooltip = (page: import('@playwright/test').Page) => page.getByRole('tooltip');

test('hovering a toolbar control names it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?scenario=happy-path&mode=compare');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  // The toolbar's own names come from the tooltip now, so no native title popups remain.
  expect(await page.locator('.topbar [title]').count()).toBe(0);

  // Every icon-only control names itself, including the protocol modes.
  const expected: [string, string][] = [
    ['lessons-open', 'Guided lessons'],
    ['share', 'Copy a link to this exact moment'],
    ['play', 'Play (Space)'],
    ['step-event', 'Step one engine event (.)'],
    ['step-slot', 'Advance one slot (→)'],
    ['mode-compare', 'Both protocols side by side on the same scenario'],
  ];
  for (const [id, text] of expected) {
    await page.getByTestId(id).hover();
    await expect(tooltip(page), `${id} has no tooltip`).toHaveText(text);
  }

  // It sits under the control it describes, and horizontally on it.
  await page.getByTestId('step-event').hover();
  await expect(tooltip(page)).toHaveText('Step one engine event (.)');
  const stepEvent = (await page.getByTestId('step-event').boundingBox())!;
  const tip = (await tooltip(page).boundingBox())!;
  expect(tip.y).toBeGreaterThanOrEqual(stepEvent.y + stepEvent.height);
  const centre = stepEvent.x + stepEvent.width / 2;
  expect(tip.x + tip.width / 2).toBeGreaterThan(stepEvent.x - 20);
  expect(tip.x + tip.width / 2).toBeLessThan(centre + 60);

  // Leaving hides it.
  await page.mouse.move(700, 400);
  await expect(tooltip(page)).toHaveCount(0);

  // And it cannot swallow a click: park the cursor on a control so its tooltip is up, then
  // click straight through it and check the transport still advanced a slot.
  await page.getByTestId('step-slot').hover();
  await expect(tooltip(page)).toHaveText('Advance one slot (→)');
  const before = await page.getByTestId('readout').textContent();
  await page.getByTestId('step-slot').click();
  await expect(tooltip(page)).toBeVisible();
  await expect(page.getByTestId('readout')).not.toHaveText(before!);

  // The play button renames itself as it toggles.
  await page.getByTestId('play').hover();
  await expect(tooltip(page)).toHaveText('Play (Space)');
  await page.getByTestId('play').click();
  await page.getByTestId('play').hover();
  await expect(tooltip(page)).toHaveText('Pause (Space)');

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('keyboard focus names controls too, and Escape dismisses it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  // Focus is deliberate, so it shows at once rather than after the hover delay.
  await page.getByTestId('share').focus();
  await expect(tooltip(page)).toHaveText('Copy a link to this exact moment');
  await page.keyboard.press('Escape');
  await expect(tooltip(page)).toHaveCount(0);

  // Escape leaves focus where it was, so the shortcut layer is untouched.
  await expect(page.getByTestId('share')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('share-toast')).toContainText('Link copied');
});
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

test('a dialog traps focus, closes on Escape and restores focus', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  const lessons = page.getByTestId('lessons-open');
  await lessons.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();

  // Focus starts inside the dialog, not back on the button that opened it.
  const insideOnOpen = await page.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement));
  expect(insideOnOpen).toBe(true);

  // Tab cycles within the dialog rather than walking the app behind it.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement))).toBe(true);
  }

  // The arrow shortcuts are inert while a dialog is open.
  const before = await page.getByTestId('readout').textContent();
  await page.getByRole('dialog').locator('.lesson-card').first().focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.getByTestId('readout').textContent()).toBe(before);
  await expect(page.getByRole('dialog')).toBeVisible();

  // Escape closes and hands focus back to the opener.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lessons).toBeFocused();

  // The custom scenario dialog gets the same treatment, focusing its textarea.
  // (getByLabel would be ambiguous: the dialog is labelled by the same heading.)
  const editor = page.getByRole('textbox', { name: 'Custom scenario JSON' });
  // selectOption() does not focus the select itself, so do what a user does.
  await page.getByTestId('scenario-select').focus();
  await page.getByTestId('scenario-select').selectOption('__custom');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('scenario-select')).toBeFocused();
});

test('keyboard focus is visible on every control it lands on', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  const focusRing = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { tag: `${el.tagName}.${el.className.split(' ')[0]}`, style: cs.outlineStyle, width: cs.outlineWidth };
    });

  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    const ring = await focusRing();
    expect(ring, 'Tab walked off into nothing').not.toBeNull();
    expect(ring!.style, `${ring!.tag} has no focus ring`).toBe('solid');
    expect(ring!.width, `${ring!.tag} focus ring is not 2px`).toBe('2px');
  }
});

test('Space on a focused lesson card opens that lesson rather than starting playback', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  await page.getByTestId('lessons-open').click();
  const first = page.getByRole('dialog').locator('.lesson-card').first();
  await first.focus();
  await page.keyboard.press('Space');

  await expect(page.getByTestId('lesson-panel')).toBeVisible();
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
});

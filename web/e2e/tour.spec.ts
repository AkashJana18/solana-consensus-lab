import { expect, test, type Page } from '@playwright/test';
import { TOUR_STEPS } from '../src/tour/steps';

/**
 * The component tour: open it, walk all eighteen steps, close it.
 *
 * Nothing here needs a webdriver escape hatch, because the tour is opt-in: it only exists
 * once someone presses the button. That is the point of making it opt-in, and it is why
 * adding it could not break any other spec.
 *
 * The tour button is hidden below 1076px (see the note by that rule in global.css), so every
 * test here runs at 1440.
 */

const ready = async (page: Page) => {
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
};

const open = async (page: Page) => {
  await page.goto('/?scenario=happy-path&mode=compare');
  await ready(page);
  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
};

test('the tour is closed until it is asked for, and can be reopened', async ({ page }) => {
  await page.goto('/?scenario=happy-path');
  await ready(page);

  // Nothing appears on its own: no ring, no card, no first-run anything.
  await expect(page.getByTestId('tour-card')).toHaveCount(0);
  await expect(page.locator('.tour-ring')).toHaveCount(0);

  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
  await expect(page.getByTestId('tour-toggle')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour-card')).toHaveCount(0);
  await expect(page.getByTestId('tour-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('every step finds its target and rings it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await open(page);

  for (const [i, step] of TOUR_STEPS.entries()) {
    const card = page.getByTestId('tour-card');
    await expect(card).toContainText(`${i + 1} / ${TOUR_STEPS.length}`);
    // The heading names the control, not the region it sits in.
    await expect(card.locator('.tour-label')).toHaveText(step.label);

    // A step whose selector matches nothing centres the card and says so. That is the
    // designed fallback, not a failure, but in compare mode at 1440 every one of these
    // targets exists, so the ring must be on screen for every step.
    await expect(page.locator('.tour-ring')).toHaveCount(1);
    await expect(card).not.toContainText('not on screen at this width');

    if (i < TOUR_STEPS.length - 1) await page.getByTestId('tour-next').click();
  }

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

/**
 * The ring's box once it has stopped moving.
 *
 * A step change commits in two passes: the render that carries the new label, then the
 * effect that re-measures the target and writes the ring's style. And the ring animates over
 * 0.18s. So a single boundingBox() can be a frame behind, or mid-flight, and both read as a
 * ring in the wrong place. Polling until two consecutive reads agree waits for both without
 * guessing a sleep duration.
 */
const settledRing = async (page: Page): Promise<{ x: number; y: number }> => {
  let prev = '';
  await expect
    .poll(
      async () => {
        const b = await page.locator('.tour-ring').boundingBox();
        const cur = `${Math.round(b?.x ?? -1)},${Math.round(b?.y ?? -1)}`;
        const same = cur === prev;
        prev = cur;
        return same;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  const b = (await page.locator('.tour-ring').boundingBox())!;
  return { x: b.x, y: b.y };
};

test('the ring follows reading order across the window', async ({ page }) => {
  // Top bar left to right, then the canvas, then the right-hand column, then the timeline.
  // Asserted on the ring rather than on the array because it is the ring the reader watches
  // move, and a reordering that only changed the data would be a different bug. The canvas
  // cell nests the caption and legend inside it, so only the non-nested stops are compared:
  // the top bar's ten run strictly left to right, and the timeline is ringed last because it
  // is the bottom row.
  await open(page);
  const topBar: number[] = [];

  for (const [i, step] of TOUR_STEPS.entries()) {
    const ring = await settledRing(page);
    if (i < 10) topBar.push(ring.x);
    if (step.id === 'timeline') expect(ring.y, 'the timeline is the bottom row').toBeGreaterThan(700);
    if (i < TOUR_STEPS.length - 1) await page.getByTestId('tour-next').click();
  }

  expect(topBar).toHaveLength(10);
  for (let i = 1; i < topBar.length; i++) {
    expect(topBar[i], `top bar step ${i} moves right, not back`).toBeGreaterThanOrEqual(topBar[i - 1]);
  }
});

test('the ring is Solana green and does not block clicks', async ({ page }) => {
  await open(page);
  await page.getByTestId('tour-next').click(); // on to the scenario select

  const ring = page.locator('.tour-ring');
  await expect(ring).toHaveCSS('border-top-color', 'rgb(20, 241, 149)');
  await expect(ring).toHaveCSS('pointer-events', 'none');

  // The ring must not swallow the click it is pointing at: the tour explains a control, so
  // someone should be able to use that control while it is being described.
  await expect(ring).toHaveCount(1);
  await page.getByTestId('play').click({ trial: false }).catch(() => undefined);
  await expect(page.getByTestId('tour-card')).toBeVisible();
});

test('the ring tracks its target rather than sitting at stale coordinates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const first = await page.locator('.tour-ring').boundingBox();

  // Narrowing the window moves the top bar's contents. The ring has to re-measure, or it
  // ends up highlighting a patch of empty background.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.tour-ring')).toBeVisible();
  await page.waitForTimeout(250);
  const second = await page.locator('.tour-ring').boundingBox();

  expect(Math.abs((second?.x ?? 0) - (first?.x ?? 0)) + Math.abs((second?.y ?? 0) - (first?.y ?? 0))).toBeGreaterThan(0);
});

test('arrow keys move through the tour and do not scrub the clock', async ({ page }) => {
  await open(page);
  const before = await page.getByTestId('readout').textContent();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tour-card')).toContainText(`2 / ${TOUR_STEPS.length}`);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tour-card')).toContainText(`1 / ${TOUR_STEPS.length}`);

  // ArrowRight is the step-a-slot shortcut everywhere else in the app. While the tour is
  // open it belongs to the tour.
  expect(await page.getByTestId('readout').textContent()).toBe(before);
});

test('Escape closes the tour without starting playback', async ({ page }) => {
  await open(page);
  await page.getByTestId('tour-next').click();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour-card')).toHaveCount(0);
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
});

test('Back is absent on the first step and Next becomes Done on the last', async ({ page }) => {
  // Done closes the tour, which is the one place the tour writes to the store mid-flow.
  // Collecting console errors here is deliberate: a setState-during-render only fires on
  // the final step, so a spec that stops early never sees it.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await open(page);
  await expect(page.getByTestId('tour-back')).toHaveCount(0);
  await expect(page.getByTestId('tour-next')).toHaveText('Next');

  for (let i = 0; i < TOUR_STEPS.length - 1; i++) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-next')).toHaveText('Done');
  await expect(page.getByTestId('tour-back')).toBeVisible();

  // Done closes rather than wrapping or advancing past the end.
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-card')).toHaveCount(0);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('the tour never changes the simulation', async ({ page }) => {
  await open(page);
  const readout = await page.getByTestId('readout').textContent();
  const mode = await page.getByTestId('mode-compare').getAttribute('aria-checked');

  for (let i = 0; i < TOUR_STEPS.length - 1; i++) await page.getByTestId('tour-next').click();

  // Walking all eighteen steps must leave the run exactly where it started. A tour that
  // switched modes or loaded a scenario would be teaching by mutating the thing it
  // describes, which is what the lessons are for.
  expect(await page.getByTestId('readout').textContent()).toBe(readout);
  expect(await page.getByTestId('mode-compare').getAttribute('aria-checked')).toBe(mode);
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
});

test('a step whose target is absent says so instead of pointing at nothing', async ({ page }) => {
  // Tower-only mode has no Votor tab: Inspector.tsx filters tabs by protocol, so there is
  // genuinely nothing to highlight on that step.
  await page.goto('/?scenario=happy-path&mode=tower');
  await ready(page);
  await expect(page.getByTestId('tab-votor')).toHaveCount(0);

  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();

  const card = page.getByTestId('tour-card');
  const votorIndex = TOUR_STEPS.findIndex((s) => s.id === 'votor');

  for (let i = 0; i < votorIndex; i++) await page.getByTestId('tour-next').click();
  await expect(card).toContainText('Alpenglow only');
  await expect(card).toContainText('not on screen at this width');
  await expect(page.locator('.tour-ring')).toHaveCount(0);

  // Next still works, and the following step finds its target.
  await page.getByTestId('tour-next').click();
  await expect(page.locator('.tour-ring')).toHaveCount(1);
  await expect(card).not.toContainText('not on screen at this width');
});

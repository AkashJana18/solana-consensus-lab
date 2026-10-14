import { expect, test, type Page } from '@playwright/test';
import { visibleSteps } from '../src/tour/steps';

/**
 * The component tour: open it, walk every step, close it.
 *
 * Nothing here needs a webdriver escape hatch, because the tour is opt-in: it only exists
 * once someone presses the button. That is the point of making it opt-in, and it is why
 * adding it could not break any other spec.
 *
 * The tour button is hidden below 1300px (see the rule by .tour-btn in global.css), so every
 * test here runs at 1440, and at that width every remaining step has its target on screen.
 */

const ready = async (page: Page) => {
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });
};

/** Compare mode runs both protocols, so it is the only mode that shows all twenty steps. */
const open = async (page: Page) => {
  await page.goto('/?scenario=happy-path&mode=compare');
  await ready(page);
  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
};

/** Click Next until the tour is showing `id`, and return the step's index. */
const goTo = async (page: Page, id: string, from = 0) => {
  const steps = visibleSteps('compare');
  const want = steps.findIndex((s) => s.id === id);
  for (let i = from; i < want; i++) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-card').locator('.tour-label')).toHaveText(
    steps.find((s) => s.id === id)!.label,
  );
  return want;
};

/**
 * The ring's box once it has stopped moving.
 *
 * A step change commits in two passes: the render that carries the new label, then the
 * effect that re-measures the target and writes the ring's style. And the ring animates
 * over 0.18s. So a single boundingBox() can be a frame behind, or mid-flight, and both
 * read as a ring in the wrong place. Polling until two consecutive reads agree waits for
 * both without guessing a sleep duration.
 */
const settledRing = async (page: Page): Promise<{ x: number; y: number; width: number }> => {
  let prev = '';
  await expect
    .poll(
      async () => {
        const b = await page.locator('.tour-ring').boundingBox();
        const cur = `${Math.round(b?.x ?? -1)},${Math.round(b?.y ?? -1)},${Math.round(b?.width ?? -1)}`;
        const same = cur === prev;
        prev = cur;
        return same;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  const b = (await page.locator('.tour-ring').boundingBox())!;
  return { x: b.x, y: b.y, width: b.width };
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
  const steps = visibleSteps('compare');

  for (const [i, step] of steps.entries()) {
    const card = page.getByTestId('tour-card');
    await expect(card).toContainText(`${i + 1} / ${steps.length}`);
    // The heading names the control, not the region it sits in.
    await expect(card.locator('.tour-label')).toHaveText(step.label);

    // A step whose selector matches nothing centres the card and says so. That is the
    // designed fallback, not a failure, but in compare mode at 1440 every one of these
    // targets exists, so the ring must be on screen for every step.
    await expect(page.locator('.tour-ring')).toHaveCount(1);
    await expect(card).not.toContainText('not on screen');

    if (i < steps.length - 1) await page.getByTestId('tour-next').click();
  }

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('the ring follows reading order across the window', async ({ page }) => {
  // Top bar left to right, then the canvas, then the right-hand column, then the timeline.
  // Asserted on the ring rather than on the array because it is the ring the reader watches
  // move. The canvas cell nests the caption and legend inside it, so only the non-nested
  // stops are compared: the top bar's ten run strictly left to right, and the timeline is
  // ringed last because it is the bottom row.
  await open(page);
  const steps = visibleSteps('compare');
  const topBar: number[] = [];

  for (const [i, step] of steps.entries()) {
    const ring = await settledRing(page);
    if (i < 10) topBar.push(ring.x);
    if (step.id === 'timeline') expect(ring.y, 'the timeline is the bottom row').toBeGreaterThan(700);
    if (i < steps.length - 1) await page.getByTestId('tour-next').click();
  }

  expect(topBar).toHaveLength(10);
  for (let i = 1; i < topBar.length; i++) {
    expect(topBar[i], `top bar step ${i} moves right, not back`).toBeGreaterThanOrEqual(topBar[i - 1]);
  }
});

test('a panel step opens its tab and rings the panel rather than the tab button', async ({ page }) => {
  // The bug this covers: the panels are only mounted when their tab is active, and these
  // steps used to point at the tab buttons instead of the content. So the tour described a
  // panel that was never on screen and the card floated in the middle of the window
  // pointing at nothing. All five tabs are covered, in tab-strip order.
  await open(page);
  let at = 0;

  for (const id of ['transaction', 'votor', 'tower', 'events', 'metrics'] as const) {
    at = await goTo(page, id, at);

    // The tab is really selected, so the panel is really on screen.
    await expect(page.getByTestId(`tab-${id}`)).toHaveAttribute('aria-selected', 'true');
    const panel = page.locator(`[data-tour="panel-${id}"]`);
    await expect(panel).toHaveCount(1);

    const ring = await settledRing(page);
    const box = (await panel.boundingBox())!;
    expect(Math.abs(ring.x - box.x), `${id} ring is on the panel`).toBeLessThan(2);
    expect(Math.abs(ring.width - box.width), `${id} ring spans the panel`).toBeLessThan(2);

    // And the card must not cover the panel it just described. The panel is 682px tall at
    // this viewport, so neither above nor below fits and the card has to go beside it.
    await expect(page.getByTestId('tour-card')).toHaveAttribute('data-side', 'left');
    const card = (await page.getByTestId('tour-card').boundingBox())!;
    expect(card.x + card.width, `${id} card overlaps the panel`).toBeLessThanOrEqual(box.x + 1);
  }
});

test('the tour puts the inspector tab back when it closes', async ({ page }) => {
  // Opened on a non-default tab so restoring to `transaction` cannot pass by accident.
  await page.goto('/?scenario=happy-path&mode=compare&tab=events');
  await ready(page);
  await expect(page.getByTestId('tab-events')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('tour-toggle').click();
  await goTo(page, 'votor');
  await expect(page.getByTestId('tab-votor')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tab-events')).toHaveAttribute('aria-selected', 'true');
});

test('closing from the top bar button also restores the tab', async ({ page }) => {
  // The one route out that never passes through the card's own handlers: the toggle writes
  // tourOpen directly. Restoration lives on an effect keyed on `open` so that this path is
  // covered too.
  await page.goto('/?scenario=happy-path&mode=compare&tab=metrics');
  await ready(page);
  await expect(page.getByTestId('tab-metrics')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('tour-toggle').click();
  await goTo(page, 'tower');
  await expect(page.getByTestId('tab-tower')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-card')).toHaveCount(0);
  await expect(page.getByTestId('tab-metrics')).toHaveAttribute('aria-selected', 'true');
});

test('a panel step the current mode cannot show is skipped rather than shown empty', async ({ page }) => {
  // Tower-only mode has no Votor tab: Inspector.tsx filters tabs by protocol, so there is no
  // tab for the tour to open. Switching protocol mode instead would rebuild both workers and
  // restart the run, so the step is dropped and the counter reflects the shorter list.
  await page.goto('/?scenario=happy-path&mode=tower');
  await ready(page);
  await expect(page.getByTestId('tab-votor')).toHaveCount(0);

  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();

  const steps = visibleSteps('tower');
  expect(steps.map((s) => s.id)).not.toContain('votor');
  expect(steps.map((s) => s.id)).toContain('tower');
  await expect(page.getByTestId('tour-card')).toContainText(`1 / ${steps.length}`);

  // Every step that remains still finds its target: no centred, empty card anywhere.
  for (const [i] of steps.entries()) {
    await expect(page.getByTestId('tour-card')).toContainText(`${i + 1} / ${steps.length}`);
    await expect(page.locator('.tour-ring')).toHaveCount(1);
    await expect(page.getByTestId('tour-card')).not.toContainText('not on screen');
    if (i < steps.length - 1) await page.getByTestId('tour-next').click();
  }
});

test('the ring is Solana green and does not block clicks', async ({ page }) => {
  await open(page);
  await page.getByTestId('tour-next').click(); // on to the protocol mode

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
  await expect(page.getByTestId('tour-card')).toContainText(`2 / ${visibleSteps('compare').length}`);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tour-card')).toContainText(`1 / ${visibleSteps('compare').length}`);

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

  const steps = visibleSteps('compare');
  for (let i = 0; i < steps.length - 1; i++) await page.getByTestId('tour-next').click();
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

  const steps = visibleSteps('compare');
  for (let i = 0; i < steps.length - 1; i++) await page.getByTestId('tour-next').click();

  // Walking all twenty steps must leave the run exactly where it started. A tour that
  // switched modes or loaded a scenario would be teaching by mutating the thing it
  // describes, which is what the lessons are for. Opening an inspector tab is not the
  // simulation: it renders the same events into a different column.
  expect(await page.getByTestId('readout').textContent()).toBe(readout);
  expect(await page.getByTestId('mode-compare').getAttribute('aria-checked')).toBe(mode);
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
});

import { expect, test, type Locator } from '@playwright/test';

const PAD_L = 76;
const PAD_R = 8;

/** The playhead's x, read straight off the SVG. */
async function playheadX(head: Locator): Promise<number> {
  return head.evaluate((el) => Number(el.getAttribute('x1')));
}

test('the timeline draws its bands once and moves only the playhead', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?scenario=happy-path');
  await expect(page.locator('.canvas-caption .muted').first()).toContainText('slot', { timeout: 15_000 });

  const svg = page.getByTestId('timeline');
  const head = page.getByTestId('timeline-playhead');
  // A vertical <line> has a zero-width box, so assert on its geometry, not visibility.
  await expect(head).toHaveCount(1);
  const width = (await svg.boundingBox())!.width;

  // Leader bands and slot ticks are present from the first paint.
  expect(await svg.locator('rect').count()).toBeGreaterThan(0);
  expect(await svg.locator('text.tl-tick').count()).toBeGreaterThan(0);

  // The clock starts at zero, so the playhead sits at the left gutter.
  expect(await playheadX(head)).toBeCloseTo(PAD_L, 0);

  // Stage markers still appear as the run reaches them: they subscribe to txStages and
  // must not be frozen by the memoised static layer.
  await page.getByTestId('play').click();
  await expect
    .poll(async () => (await svg.locator('title').allTextContents()).filter((t) => t.startsWith('finalized @')), { timeout: 30_000 })
    .toHaveLength(1);
  // All eight hero-tx stages are marked by the end of happy-path.
  expect((await svg.locator('title').allTextContents()).length).toBe(8);

  // Paused, the playhead tracks a scrub proportionally: it is the only part of the SVG
  // that may move on its own.
  await page.getByTestId('play').click();
  await svg.click({ position: { x: width * 0.75, y: 40 } });
  await expect.poll(() => playheadX(head), { timeout: 5_000 }).toBeGreaterThan(PAD_L + 0.7 * (width - PAD_L - PAD_R));
  const seeked = await playheadX(head);
  expect(seeked).toBeLessThan(PAD_L + 0.8 * (width - PAD_L - PAD_R));

  // A paused clock does not drift.
  await page.waitForTimeout(500);
  expect(await playheadX(head)).toBe(seeked);

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

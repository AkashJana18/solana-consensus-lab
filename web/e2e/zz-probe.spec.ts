import { expect, test } from '@playwright/test';

/**
 * TEMPORARY probe. Not to be merged.
 *
 * The top bar thresholds cannot be measured on a developer machine: the macOS
 * `system-ui` and the Linux CI runner's resolve to different fonts, and the bar
 * comes out a couple of hundred pixels apart. This walks the worst case at
 * several widths and prints the document's real scrollWidth on THIS runner, so
 * the thresholds can be set from the machine that actually enforces them.
 */
test('probe: report the real widths on this runner', async ({ page }) => {
  const rows: string[] = [];
  for (const width of [1200, 1300, 1400, 1440, 1500, 1600, 1700, 1800, 1900, 2000]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?scenario=leader-down&mode=compare&speed=20');
    await page.waitForSelector('.topbar');
    await page.waitForTimeout(700);
    // Force the wordmark on so this measures the bar, not the rule that hides it.
    await page.addStyleTag({ content: '.brand span:not(.brand-mark) { display: inline !important; }' });
    await page.waitForTimeout(50);
    const r = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      bar: Math.round((document.querySelector('.topbar') as HTMLElement).scrollWidth),
      stars: getComputedStyle(document.querySelector('.repo-stars') as HTMLElement).display,
      font: getComputedStyle(document.body).fontFamily,
    }));
    rows.push(
      `PROBE w=${width} doc=${r.doc} inner=${r.inner} bar=${r.bar} overflow=${r.doc > r.inner ? 'YES' : 'no'} stars=${r.stars} font=${r.font}`,
    );
  }
  // Printed in one line so it survives the CI log's formatting.
  console.log('\n' + rows.join('\n') + '\n');
  expect(rows.length).toBeGreaterThan(0);
});
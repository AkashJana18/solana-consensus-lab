/**
 * Walk the top bar down from a wide viewport and report the narrowest width at which the
 * document does not scroll sideways, with the wordmark forced visible. This is the
 * measurement the `@media (max-width: N)` rule near the bottom of global.css is derived
 * from, and the reason that rule carries a "re-measure after touching the bar" note.
 *
 * Run it from web/: bunx tsx scripts/measure-topbar.ts   (or bun scripts/measure-topbar.ts)
 * It starts its own dev server unless one is already listening on --port.
 *
 * What it reports, worst case first:
 *   - the narrowest viewport that fits the bar with the wordmark on (the threshold to set)
 *   - every descendant whose scrollWidth exceeds its clientWidth, because .segmented crops
 *     silently (overflow: hidden) and so never shows up as a document-level scrollbar
 *
 * The worst case is the one the responsive spec names: leader-down (a 20s scenario, so the
 * clock reads "20000.0"), compare mode, 20x speed. Measuring a lucky case is how the
 * committed numbers drifted from the real ones in the first place.
 */

import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const URL = '/?scenario=leader-down&mode=compare&speed=20';
const START = Number(process.env.START ?? 1700);
const FLOOR = Number(process.env.FLOOR ?? 900);

/** Widest gap between two widths we probe. Fine enough to name an exact threshold. */
const STEP = 2;

interface Probe {
  width: number;
  doc: number;
  fits: boolean;
  culprits: string[];
}

async function probe(page: import('@playwright/test').Page, width: number): Promise<Probe> {
  await page.setViewportSize({ width, height: 900 });
  // Force the wordmark on so we measure the bar as it is *before* the rule that hides it.
  // Without this the query answers "at what width did it hide", which is the rule, not the
  // bar, and the two drift apart the moment anything else in the bar changes.
  await page.addStyleTag({
    content: '.brand span:not(.brand-mark) { display: inline !important; }',
  });
  await page.waitForTimeout(30);
  const r = await page.evaluate(() => {
    const doc = document.documentElement.scrollWidth;
    const culprits: string[] = [];
    const walk = document.querySelectorAll<HTMLElement>('.topbar, .topbar *');
    for (const el of walk) {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        culprits.push(
          `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(/\s+/).join('.') : ''} ` +
            `(${el.scrollWidth} > ${el.clientWidth})`,
        );
      }
    }
    return { doc, culprits: culprits.slice(0, 6) };
  });
  return { width, doc: r.doc, fits: r.doc <= width, culprits: r.culprits };
}

const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: 'dark' });
await page.goto(BASE + URL);
await page.waitForSelector('.topbar', { timeout: 30_000 });
// Let the run settle so the clock and star count have their final, widest values.
await page.waitForTimeout(1_500);

// Walk the whole range. Fitting is monotonic in width for a bar this shape, so the answer
// is the narrowest probe that fits, not the first one encountered on the way down.
const probes: Probe[] = [];
for (let w = START; w >= FLOOR; w -= STEP) probes.push(await probe(page, w));

const good = probes.filter((p) => p.fits);
const narrowestGood = good.length ? good[good.length - 1] : null;
const justTooNarrow = probes.find((p) => !p.fits && narrowestGood !== null && p.width > narrowestGood.width);

console.log(`worst case: ${URL}`);
if (narrowestGood) {
  console.log(`  narrowest viewport that fits with the wordmark on: ${narrowestGood.width}px`);
} else {
  console.log(`  never fits down to ${FLOOR}px`);
}
if (justTooNarrow) {
  console.log(`  one step narrower (${justTooNarrow.width}px) needed ${justTooNarrow.doc}px`);
  const widest = probes.reduce((a, b) => (b.doc > a.doc ? b : a));
  console.log(`  widest document seen: ${widest.doc}px at a ${widest.width}px viewport`);
  const culprits = new Set(probes.flatMap((p) => p.culprits));
  if (culprits.size) {
    console.log('  overflowing descendants:');
    for (const c of culprits) console.log(`    ${c}`);
  }
}

await browser.close();
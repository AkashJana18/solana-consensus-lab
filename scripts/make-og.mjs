#!/usr/bin/env node
// Render web/public/og.png, the link-preview card.
//
// X (and LinkedIn, Slack, Discord) want a large card at 1.91:1, so this renders
// 1200x630. The repo's own 4:1 banner cannot serve that: a centre crop to 1.91:1
// would keep only the middle 48% of its width, cutting the mark and the right-hand
// end of the wordmark. Its photograph also has the wordmark baked into it, so there
// is no clean region to lift either, which is why the card is built from the vector
// mark and the brand gradient instead.
//
// The PNG is committed and served straight out of web/public, so nothing in the
// build runs this. Re-run it by hand after editing the copy or the mark:
//
//   node scripts/make-og.mjs
//
// The type is the app's own stack (system-ui), so the card matches the product.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web/public/og.png');
const WIDTH = 1200;
const HEIGHT = 630;

// The browser tooling is a web/ devDependency and there is no node_modules at the
// repo root, so resolve it against web/package.json rather than this file.
const require = createRequire(join(ROOT, 'web/package.json'));
const { chromium } = require('playwright');

// Sampled by hand from the gradient in web/public/scl-logo.svg, which runs teal
// through blue to purple. Keep in step with that file if the mark is recoloured.
const RAMP = ['#58C0A1', '#43B6C0', '#589DC6', '#6B86C3', '#7572B5', '#7669AF', '#7B5CA7', '#8357A4'];

const MARK = await readFile(join(ROOT, 'web/public/scl-logo.svg'), 'utf8');

// Two soft washes from the ramp, one per corner, so the dark field is not flat at
// thumbnail size. The trailing hex pair is the alpha channel.
const WASH_TEAL = `${RAMP[0]}26`;
const WASH_PURPLE = `${RAMP[7]}2e`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background-color: #0a0b10;
    color: #fff;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    display: flex;
    align-items: center;
    background-image:
      radial-gradient(120% 90% at 8% 100%, ${WASH_TEAL} 0%, transparent 55%),
      radial-gradient(90% 80% at 100% 0%, ${WASH_PURPLE} 0%, transparent 58%);
  }
  .wrap { display: flex; align-items: center; gap: 44px; padding: 0 84px; }
  .mark { flex: none; height: 104px; }
  .mark svg { display: block; height: 100%; width: auto; }
  h1 { font-size: 60px; font-weight: 650; letter-spacing: -0.02em; line-height: 1.05; }
  p { margin-top: 16px; font-size: 27px; color: rgba(255, 255, 255, 0.7); }
  /* The ramp as a rule under the text, echoing the bars in the mark. */
  .rule { margin-top: 34px; width: 300px; height: 5px; border-radius: 3px;
          background: linear-gradient(90deg, ${RAMP.join(', ')}); }
</style></head>
<body>
  <div class="wrap">
    <div class="mark">${MARK}</div>
    <div>
      <h1>Solana Consensus Lab</h1>
      <p>From 12.8s to 150ms. See it happen.</p>
      <div class="rule"></div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await tab.setContent(html, { waitUntil: 'load' });
const png = await tab.screenshot({ type: 'png' });
await browser.close();

await writeFile(OUT, png);
console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(0)} KB)`);
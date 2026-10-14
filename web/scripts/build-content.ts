#!/usr/bin/env bun
// Writes the generated guides into web/dist, after `vite build` has emptied it there.
//
// Why this exists
// ---------------
// The app is a client-rendered SPA: dist/index.html is the source index.html plus two
// injected tags, and its body is empty until React mounts. Everything a visitor can read
// (lesson prose, the protocol reference) is behind a wasm boot and a click, so a crawler
// sees a blank document and the whole product counts as one indexable URL.
//
// The pages written here are plain HTML with no script at all. They cost nothing at request
// time, they work with JavaScript disabled, and they are the only part of this site that
// search engines and link unfurlers can actually read. Their content lives in pages.ts, the
// rendering in render.ts, and the tests in test/content.test.ts.
//
// Links are relative on purpose. vite base is './' so the same dist can be copied to a
// GitHub Pages sub-path, and an absolute "/lessons.html" would resolve against the Pages
// domain's root instead. Canonicals are absolute and point at the Vercel deployment, which
// is the canonical copy; the Pages build is the one that should defer to it.
//
// Output goes to web/public rather than straight into web/dist, so that the Vite dev server
// serves the same pages the build does and the e2e suite can assert against real HTTP
// responses. That means running this before `vite build`, not after: Vite copies public/
// into dist as it builds. The files are gitignored build output, and regenerating is part
// of `bun run build`, so they cannot go stale in a committed tree.
//
// Run via `bun run build`, which chains this ahead of `vite build`. Not invoked separately
// in CI: the `web` job runs `bun run build`, which already covers it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, sitemapXml } from './content/render';
import { buildPages } from './content/pages';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const pages = buildPages();
for (const page of pages) {
  const out = join(PUBLIC, page.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderPage(page, pages));
  console.log(`  built public${page.path}`);
}

// The app itself is listed too: it is the destination every CTA points at, and the
// prerendered shell in index.html is the only on-page text it has.
writeFileSync(join(PUBLIC, 'sitemap.xml'), sitemapXml(['/', ...pages.map((p) => p.path)]));
console.log(`  built public/sitemap.xml (${pages.length + 1} urls)`);
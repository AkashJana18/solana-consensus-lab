// Pure rendering helpers for the generated guides. No file reads, no writes, no side
// effects on import, so test/content.test.ts can exercise the builders directly.

import { parseMarkdown, type Block, type Inline } from '../../src/lessons/markdown';

/** The canonical deployment. web/index.html hardcodes the same origin; keep the two in step. */
export const ORIGIN = 'https://www.solanaconsensuslab.com';
export const SITE = 'Solana Consensus Lab';
export const REPO = 'https://github.com/AkashJana18/solana-consensus-lab/blob/main/';

// ---------------------------------------------------------------- html escaping

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Everything rendered here is authored prose, but protocols.md contains a literal `< 20%`
 *  and an ampersand, so escaping is load-bearing rather than defensive. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** JSON-LD sits inside a <script>, so it is emitted with JSON.stringify and only needs
 *  `<` neutralised to avoid closing the tag early. */
export function jsonLd(nodes: unknown[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
}

// -------------------------------------------------------------------- markdown

/**
 * Repo-relative targets named in docs/*.md have no web equivalent, so they become links
 * into the repository. Anything else absolute stays absolute.
 */
const REPO_LINKS: Record<string, string> = {
  'architecture.md': `${REPO}docs/architecture.md`,
  'protocols.md': `${REPO}docs/protocols.md`,
  'wasm-api.md': `${REPO}docs/wasm-api.md`,
};

function renderLink(text: string, href: string): string {
  if (/^https?:\/\//.test(href)) {
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(text)}</a>`;
  }
  const mapped = REPO_LINKS[href];
  if (mapped) {
    return `<a href="${esc(mapped)}" target="_blank" rel="noreferrer noopener">${esc(text)}</a>`;
  }
  return `<a href="${esc(href)}">${esc(text)}</a>`;
}

export function renderInlines(inlines: readonly Inline[]): string {
  return inlines
    .map((x) => {
      switch (x.kind) {
        case 'bold':
          return `<strong>${esc(x.text)}</strong>`;
        case 'code':
          return `<code>${esc(x.text)}</code>`;
        case 'link':
          return renderLink(x.text, x.href);
        default:
          return esc(x.text);
      }
    })
    .join('');
}

export type TableBlock = Extract<Block, { kind: 'table' }>;

export function renderTable(t: TableBlock): string {
  const head = t.head.map((c) => `<th scope="col">${renderInlines(c)}</th>`).join('');
  const rows = t.rows
    .map((row) => `<tr>${row.map((c) => `<td>${renderInlines(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** `## ` in the sources becomes an h2 here; the page's own h1 is supplied separately. */
export function renderBlocks(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      if (b.kind === 'h') return `<h2>${renderInlines(b.inlines)}</h2>`;
      if (b.kind === 'ul') return `<ul>${b.items.map((i) => `<li>${renderInlines(i)}</li>`).join('')}</ul>`;
      if (b.kind === 'table') return renderTable(b);
      return `<p>${renderInlines(b.inlines)}</p>`;
    })
    .join('\n');
}

/** Markdown to HTML. Note that it emits whole blocks, so never wrap the result in a
 *  `<p>`: a lead or explanation that runs to two paragraphs would nest, and the browser
 *  would close the outer tag early and spill the rest of the copy out of its box. */
export function md(src: string): string {
  return renderBlocks(parseMarkdown(src));
}

// ---------------------------------------------------------------- source slicing

/** Everything under a `## heading` up to the next one, as markdown. */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`build-content: no "## ${heading}" section found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

export function firstTable(markdown: string, what: string): TableBlock {
  const block = parseMarkdown(markdown).find((b) => b.kind === 'table');
  if (!block || block.kind !== 'table') throw new Error(`build-content: no table found in ${what}`);
  return block;
}

/** Drops a leading `# ` line and returns the rest, since the page supplies its own h1. */
export function withoutTitle(markdown: string): string {
  const lines = markdown.split('\n');
  return lines[0]?.startsWith('# ') ? lines.slice(1).join('\n') : markdown;
}

// ------------------------------------------------------------------- page model

export interface Page {
  /** Location under dist/, which is also the last part of the canonical URL. */
  file: string;
  /** Site-absolute path, always starting with "/". */
  path: string;
  /** Number of directories deep, so relative links survive a GitHub Pages sub-path. */
  depth: number;
  title: string;
  /** Short label for the cross-link nav, where `title` would be far too long. */
  nav: string;
  description: string;
  body: string;
  jsonLd: unknown[];
}

/**
 * Link prefix back to the site root. vite base is './' so the same dist can be copied to a
 * GitHub Pages sub-path, and an absolute "/lessons.html" would resolve against the Pages
 * domain's root instead.
 */
export const root = (depth: number): string => (depth === 0 ? './' : '../'.repeat(depth));

export function breadcrumb(items: { name: string; path: string }[]): unknown {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${ORIGIN}${it.path}`,
    })),
  };
}

/** Deep link straight into the running simulator, which is the point of the whole site. */
export function appLink(depth: number, query = ''): string {
  return `<a class="cta" href="${root(depth)}?${query}">Open the simulator</a>`;
}

// ------------------------------------------------------------------ page shell

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0d0e12; color: #f2f3f5; font: 16px/1.65 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.wrap { max-width: 780px; margin: 0 auto; padding: 36px 22px 80px; }
.masthead { display: flex; align-items: center; gap: 10px; margin-bottom: 34px; }
.masthead img { height: 28px; width: auto; }
.masthead span { color: #898781; font-size: 14px; }
h1 { font-size: 32px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 16px; font-weight: 650; }
h2 { font-size: 20px; margin: 36px 0 12px; letter-spacing: -0.01em; }
h3 { font-size: 16px; margin: 22px 0 6px; }
p { margin: 0 0 15px; color: #c3c2b7; }
strong { color: #f2f3f5; }
a { color: #3987e5; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .87em; background: #232730; padding: 2px 5px; border-radius: 3px; color: #f2f3f5; }
.lede { font-size: 18px; }
.meta { color: #898781; font-size: 14px; }
ul, ol { margin: 0 0 15px; padding-left: 22px; color: #c3c2b7; }
li { margin: 6px 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 18px; font-size: 14px; display: block; overflow-x: auto; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,.09); vertical-align: top; }
th { color: #f2f3f5; font-weight: 600; white-space: nowrap; }
td { color: #c3c2b7; }
.lessons { list-style: none; padding-left: 0; }
.lessons li { border-top: 1px solid rgba(255,255,255,.09); padding: 16px 0; }
.lessons li > a { font-size: 18px; text-decoration: none; }
.lessons p { margin: 6px 0 0; font-size: 15px; }
.steps li { margin: 18px 0; }
.qa { border-left: 2px solid rgba(255,255,255,.18); padding: 2px 0 2px 14px; margin: 10px 0; }
.cta { display: inline-block; margin: 0 8px 10px 0; padding: 9px 16px; border: 1px solid rgba(255,255,255,.18); border-radius: 8px; text-decoration: none; font-size: 14px; }
.cta:hover, .cta:focus-visible { border-color: #3987e5; }
footer { margin-top: 52px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,.09); color: #898781; font-size: 14px; }
footer nav { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 12px; }
`;

/** The cross-links every page carries. Cheap crawl paths, and a way back if a reader
 *  lands on one page from a search result and has never seen the app. */
export function renderPage(page: Page, nav: readonly Page[]): string {
  const r = root(page.depth);
  const canonical = `${ORIGIN}${page.path}`;
  const links = nav.map((p) => `<a href="${r}${p.path.slice(1)}">${esc(p.nav)}</a>`).join('\n        ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="${r}favicon.svg" />

    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${esc(SITE)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${ORIGIN}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${ORIGIN}/og.png" />

    <script type="application/ld+json">${jsonLd(page.jsonLd)}</script>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="masthead">
        <img src="${r}favicon.svg" alt="" aria-hidden="true" />
        <span><a href="${r}">${esc(SITE)}</a></span>
      </div>
      <main>
${page.body}
      </main>
      <footer>
        <nav>
        ${links}
        </nav>
        <p>Free and open source, Apache-2.0. Built for teaching Solana consensus.
        <a href="${REPO}">Source on GitHub</a>.</p>
      </footer>
    </div>
  </body>
</html>
`;
}

/** No <lastmod> on purpose: the generator would have to shell out to git, and a build
 *  that runs in two environments (CI and a laptop) would then disagree about the file. */
export function sitemapXml(paths: readonly string[]): string {
  const urls = paths
    .map((p) => `  <url>\n    <loc>${esc(`${ORIGIN}${p}`)}</loc>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
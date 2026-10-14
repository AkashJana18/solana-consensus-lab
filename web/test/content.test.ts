import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/lessons';
import { parseMarkdown } from '../src/lessons/markdown';
import { buildPages, comparisonPage, lessonPage, protocolsPage } from '../scripts/content/pages';
import { ORIGIN, esc, extractSection, renderInlines, renderPage, root, sitemapXml, withoutTitle } from '../scripts/content/render';

/** A `## heading` source line as the page renders it. */
function headingsToH2(line: string): string {
  const block = parseMarkdown(line).find((b) => b.kind === 'h');
  if (!block || block.kind !== 'h') throw new Error(`not a heading: ${line}`);
  return `<h2>${renderInlines(block.inlines)}</h2>`;
}

// These pages are the only text on this site a crawler can read, so they are checked here
// rather than left for a deploy to reveal. The generator is pure, so nothing below needs a
// build to have run: CI runs `bun run test` before `bun run build`.

const pages = buildPages();
const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
const protocolsSource = readFileSync(fileURLToPath(new URL('../../docs/protocols.md', import.meta.url)), 'utf8');
const robots = readFileSync(fileURLToPath(new URL('../public/robots.txt', import.meta.url)), 'utf8');
const scenarioNames = readdirSync(fileURLToPath(new URL('../../scenarios', import.meta.url)))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('generated page inventory', () => {
  it('emits one page per lesson plus the comparison, index and protocol pages', () => {
    expect(pages.map((p) => p.path)).toEqual([
      '/tower-vs-alpenglow.html',
      '/lessons.html',
      ...LESSONS.map((l) => `/lessons/${l.id}.html`),
      '/protocols.html',
    ]);
  });

  it('gives every page a distinct file and a unique title', () => {
    expect(new Set(pages.map((p) => p.file)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
  });

  it('gives every page a short, distinct nav label', () => {
    // The cross-link nav is the one place a full <title> does not fit, so each page carries
    // its own label rather than having the site name repeated eight times in a row.
    for (const p of pages) expect(p.nav.length, `${p.path} nav`).toBeLessThan(45);
    expect(new Set(pages.map((p) => p.nav)).size).toBe(pages.length);
  });

  it('gives every page a title, description, canonical, h1 and JSON-LD', () => {
    for (const p of pages) {
      const html = renderPage(p, pages);
      expect(p.title.length, `${p.path} title`).toBeGreaterThan(10);
      expect(p.description.length, `${p.path} description`).toBeGreaterThan(50);
      expect(html, `${p.path} canonical`).toContain(`<link rel="canonical" href="${ORIGIN}${p.path}" />`);
      expect(html, `${p.path} h1`).toContain('<h1>');
      expect(html, `${p.path} ld+json`).toContain('<script type="application/ld+json">');
      expect(p.jsonLd.length, `${p.path} ld+json nodes`).toBeGreaterThan(0);
    }
  });

  it('caps descriptions so a paragraph never gets pasted in as a meta description', () => {
    // The budget is generous on purpose. Lesson pages deliberately reuse the registry's
    // `summary` rather than hand-writing a second copy that could drift out of sync, and the
    // longest of those runs to 211 characters, a little past the snippet a result shows.
    // Shortening it would mean editing the copy the app also renders. This bound is here to
    // catch a whole paragraph, not to police the last few words.
    for (const p of pages) expect(p.description.length, p.path).toBeLessThan(240);
  });

  it('validates every JSON-LD graph as parseable JSON carrying a type', () => {
    for (const p of pages) {
      const html = renderPage(p, pages);
      const raw = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
      expect(raw, `${p.path} ld+json block`).toBeTruthy();
      const parsed = JSON.parse(raw!) as { '@context': string; '@graph': { '@type': string }[] };
      expect(parsed['@context']).toBe('https://schema.org');
      for (const node of parsed['@graph']) expect(node['@type'], p.path).toBeTruthy();
    }
  });

  it('links between every pair of pages', () => {
    for (const from of pages) {
      const html = renderPage(from, pages);
      for (const to of pages) {
        if (to === from) continue;
        expect(html, `${from.path} -> ${to.path}`).toContain(`href="${root(from.depth)}${to.path.slice(1)}"`);
      }
    }
  });

  it('keeps every internal link relative so the dist still works from a sub-path', () => {
    for (const p of pages) {
      for (const [, href] of renderPage(p, pages).matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (href.startsWith('http') || href.startsWith('?')) continue;
        // A leading slash would resolve against the domain root, breaking the GitHub Pages
        // sub-path build that vite's base './' exists to support.
        expect(href, `${p.path} -> ${href}`).not.toMatch(/^\//);
      }
    }
  });
});

describe('sitemap', () => {
  const xml = sitemapXml(['/', ...pages.map((p) => p.path)]);

  it('lists the app and every generated page, with no duplicates', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`, ...pages.map((p) => `${ORIGIN}${p.path}`)]);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it('agrees with robots.txt, which is what points crawlers at it', () => {
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe('lesson pages', () => {
  it('carries the lesson copy from the registry rather than a copy of it', () => {
    // The point of importing LESSONS: the published prose cannot drift from the app's.
    for (const lesson of LESSONS) {
      const html = renderPage(lessonPage(lesson, 1), pages);
      expect(html, lesson.id).toContain(`<h1>${esc(lesson.title)}</h1>`);
      expect(html, lesson.id).toContain(esc(lesson.summary));
      expect(html, lesson.id).toContain(esc(lesson.scenario));
      for (const step of lesson.steps) expect(html, `${lesson.id}/${step.id}`).toContain(esc(step.title));
    }
  });

  it('deep links into the running lesson', () => {
    for (const lesson of LESSONS) {
      expect(renderPage(lessonPage(lesson, 1), pages), lesson.id).toContain(
        `?lesson=${encodeURIComponent(lesson.id)}`,
      );
    }
  });

  it('publishes the prediction questions with their explanations', () => {
    const questions = LESSONS.flatMap((l) => l.steps.map((s) => ({ lesson: l, step: s }))).filter((x) => x.step.question);
    expect(questions.length).toBeGreaterThan(0);
    for (const { lesson, step } of questions) {
      const html = renderPage(lessonPage(lesson, 1), pages);
      const question = step.question!;
      expect(html, step.id).toContain(esc(question.prompt));
      for (const choice of question.choices) expect(html, step.id).toContain(esc(choice));
    }
  });
});

describe('rendered markup', () => {
  it('never nests a block element inside a paragraph', () => {
    // md() emits whole <p> blocks, so wrapping its output in a <p> would be invalid markup
    // and the browser would close the outer tag early, spilling the rest of the copy out of
    // its box. It has already happened once, so it is worth a permanent guard.
    for (const p of pages) {
      const html = renderPage(p, pages);
      expect((html.match(/<p[ >]/g) ?? []).length, `${p.path} unbalanced <p>`).toBe(
        (html.match(/<\/p>/g) ?? []).length,
      );
      expect(html, `${p.path} nested block`).not.toMatch(/<p[^>]*>(?:(?!<\/p>).)*<(p|ul|ol|div|h[1-6])/s);
    }
  });

  it('escapes angle brackets and ampersands in prose', () => {
    // protocols.md says "Safety holds with < 20% Byzantine stake". Left raw, that is parsed
    // as the start of a tag and the sentence vanishes.
    expect(protocolsSource).toContain('< 20%');
    const html = renderPage(protocolsPage(0), pages);
    expect(html).toContain('Safety holds with &lt; 20% Byzantine stake');
    expect(html).not.toMatch(/<(?![/!a-zA-Z])/);
  });

  it('points repo-relative links at the repository', () => {
    // protocols.md links to architecture.md, which has no web equivalent.
    const html = renderPage(protocolsPage(0), pages);
    expect(html).not.toContain('href="architecture.md"');
    expect(html).toContain('github.com/AkashJana18/solana-consensus-lab/blob/main/docs/architecture.md');
  });
});

describe('comparison page', () => {
  const html = renderPage(comparisonPage(0), pages);

  it('takes its numbers from the README results table', () => {
    for (const cell of ['451 ms', '150 ms', '563 ms', '452 ms', '462 ms', '12.7 s', '17.8 s']) {
      expect(readme, `README lost "${cell}"`).toContain(cell);
      expect(html, cell).toContain(cell);
    }
  });

  it('names every scenario the simulator ships', () => {
    for (const name of scenarioNames) expect(html, name).toContain(name);
  });

  it('links to the two scenarios its central claim depends on', () => {
    expect(html).toContain('?scenario=happy-path&amp;mode=compare');
    expect(html).toContain('?scenario=ideal&amp;mode=compare');
  });
});

describe('protocols page', () => {
  const html = renderPage(protocolsPage(0), pages);

  it('renders the reference tables rather than their raw pipes', () => {
    expect(protocolsSource).toContain('| Certificate | Counted votes | Threshold |');
    expect(html).toContain('<th scope="col">Certificate</th>');
    expect(html).toContain('<td>Fast-Finalization</td>');
    // The thresholds are the entire point of that table.
    expect(html).toContain('<td>80%</td>');
  });

  it('carries every section heading of the source document', () => {
    const headings = protocolsSource.split('\n').filter((l) => l.startsWith('## '));
    expect(headings.length).toBeGreaterThanOrEqual(4);
    for (const line of headings) {
      // Rendered rather than compared as plain text: several of these headings carry a code
      // span, which becomes a <code> element and so never appears in the page contiguously.
      const rendered = headingsToH2(line);
      expect(html, line).toContain(rendered);
    }
  });
});

describe('helpers', () => {
  it('extracts a section up to the next heading of the same level', () => {
    const src = ['# Title', '## A', 'one', '## B', 'two'].join('\n');
    expect(extractSection(src, 'A').trim()).toBe('one');
    expect(extractSection(src, 'B').trim()).toBe('two');
    expect(() => extractSection(src, 'C')).toThrow(/no "## C" section/);
  });

  it('drops a leading H1 so the page can supply its own', () => {
    expect(withoutTitle('# Hello\nbody')).toBe('body');
    expect(withoutTitle('body')).toBe('body');
  });

  it('builds relative link prefixes by depth', () => {
    expect(root(0)).toBe('./');
    expect(root(1)).toBe('../');
    expect(root(2)).toBe('../../');
  });
});
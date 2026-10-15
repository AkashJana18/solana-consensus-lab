import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToRegexp } from 'path-to-regexp';
import { LESSONS } from '../src/lessons';

/**
 * `vercel.json` is data only, and this is what keeps it that way.
 *
 * Two separate things have each broken every deployment since 58b5eee, and neither was
 * visible without attempting a deploy:
 *
 * 1. `"//"` comment keys inside `headers[]` and `functions[*]`. Vercel sets
 *    `additionalProperties: false` on both, so a comment key is an additional property and
 *    the deployment dies before the build runs. Reported as
 *    `headers[0] should NOT have additional property '/'`.
 * 2. A `source` written in RegExp syntax. Vercel parses it with path-to-regexp v6.1.0,
 *    which rejects capturing groups outright: the pattern below failed with
 *    `Capturing groups are not allowed at 2`, surfaced as
 *    https://vercel.link/invalid-route-source-pattern
 *
 * Fixing only the first exposed the second, which is why both are asserted here. The
 * patterns are parsed with the same library and version Vercel documents, so a rule that
 * compiles here compiles there. And they are checked against the paths the build actually
 * emits, so a rule that is valid but matches nothing is caught too.
 *
 * The reasoning the comments carried lives in web/README.md under
 * "`vercel.json` holds data only, and that is deliberate".
 */

const VERCEL_JSON = fileURLToPath(new URL('../../vercel.json', import.meta.url));
const doc = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as Record<string, unknown>;

/** Recursively collect keys that start with `//`, with the path that led to them. */
function commentKeys(node: unknown, path: string[] = []): string[][] {
  if (Array.isArray(node)) return node.flatMap((v, i) => commentKeys(v, [...path, String(i)]));
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      k.startsWith('//') ? [[...path, k]] : commentKeys(v, [...path, k]),
    );
  }
  return [];
}

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const RULES = doc.headers as HeaderRule[];

/** The immutable rule, and everything else, resolved by Cache-Control value. */
const immutable = RULES.filter((r) => r.headers.some((h) => h.value.includes('immutable')));
const revalidate = RULES.filter((r) => r.headers.some((h) => h.value.includes('must-revalidate')));
const matchersFor = (rules: HeaderRule[]) => rules.map((r) => pathToRegexp(r.source));
const coveredBy = (rules: HeaderRule[], path: string) => matchersFor(rules).some((re) => re.test(path));

/** Every path `build:content` writes, plus the shell and robots.txt, which are not generated. */
const GENERATED = [
  '/index.html',
  '/lessons.html',
  '/protocols.html',
  '/tower-vs-alpenglow.html',
  ...LESSONS.map((l) => `/lessons/${l.id}.html`),
  '/sitemap.xml',
  '/robots.txt',
];

describe('vercel.json', () => {
  it('carries no // comment keys anywhere', () => {
    // Vercel documents a `//` comment convention for some config files, but this schema
    // forbids additional properties and a nested one has demonstrably broken the build.
    // There is no evidence a top-level one is stripped either, so none are used and
    // web/README.md carries the prose instead.
    const found = commentKeys(doc);
    expect(found, `// comment keys are not allowed in vercel.json: ${found.map((p) => p.join('.')).join(', ')}`).toEqual([]);
  });

  it('writes every header source in path-to-regexp, not RegExp syntax', () => {
    // This is the check that would have caught the original pattern. path-to-regexp
    // rejects capturing groups, so anything wrapped in a bare (...) fails here exactly as
    // it fails on Vercel.
    for (const rule of RULES) {
      expect(() => pathToRegexp(rule.source), `${rule.source} is not valid path-to-regexp`).not.toThrow();
    }
  });

  it('caches fingerprinted assets immutably and nothing else', () => {
    for (const asset of ['/assets/index-abc123.js', '/assets/sim_wasm_bg-9f8a.wasm', '/assets/nested/deep.css']) {
      expect(coveredBy(immutable, asset), `${asset} is not immutable`).toBe(true);
    }
    // An over-broad immutable rule would freeze lesson copy in a CDN for a year.
    for (const page of GENERATED) {
      expect(coveredBy(immutable, page), `${page} must not be immutable`).toBe(false);
    }
  });

  it('revalidates every page the build writes, so an edit to lesson copy reaches people', () => {
    // A rule that is valid but matches nothing is the quiet failure mode: the deployment
    // succeeds and the caching is simply wrong, which is why coverage is asserted rather
    // than just syntax.
    const missed = GENERATED.filter((p) => !coveredBy(revalidate, p));
    expect(missed, `these generated pages would be cached without a revalidate rule: ${missed.join(', ')}`).toEqual([]);
  });

  it('gives every header rule a source and at least one header', () => {
    // `headers` is a list of routes, each with a `source` and its own header list. A rule
    // that lost its `source` would match nothing and silently stop caching.
    for (const rule of RULES) {
      expect(typeof rule.source, 'a header rule has no source').toBe('string');
      expect(rule.source).not.toBe('');
      expect(Array.isArray(rule.headers) && rule.headers.length > 0, `${rule.source} sets no headers`).toBe(true);
    }
  });

  it('points the build at the right place', () => {
    expect(doc.framework).toBe('vite');
    expect(doc.outputDirectory).toBe('web/dist');
    expect(String(doc.buildCommand)).toContain('build-wasm.sh');
    // The wasm target and the pinned wasm-bindgen are what make the build reproducible.
    expect(String(doc.installCommand)).toContain('wasm32-unknown-unknown');
    expect(String(doc.installCommand)).toContain('0.2.128');
  });

  it('never names a function the branch does not contain', () => {
    // A `functions` entry pointing at a file that is not in the tree is a build failure
    // that reads as nothing to do with headers. `main` has no api/ directory at all, so a
    // functions block here would point Vercel at a file that does not exist.
    const fns = doc.functions as Record<string, unknown> | undefined;
    if (!fns) return;
    for (const path of Object.keys(fns)) {
      expect(existsSync(resolve(fileURLToPath(new URL('../../', import.meta.url)), path)), `${path} is named in vercel.json but is not in the tree`).toBe(true);
    }
  });
});

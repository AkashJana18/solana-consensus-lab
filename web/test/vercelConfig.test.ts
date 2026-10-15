import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `vercel.json` is data only, and this is what keeps it that way.
 *
 * Vercel's schema sets `additionalProperties: false` on a `headers[]` item, allowing only
 * `source`, `headers`, `has` and `missing`, so a `"//"`-prefixed comment key inside one is
 * an additional property and fails the deployment before the build starts. Vercel reports
 * it as `headers[0] should NOT have additional property '/'`.
 *
 * This is not hypothetical. The `headers` block shipped with a `"//"` key in each item and
 * every deployment from 58b5eee onward failed with that error, which left production on
 * the last build before the block existed: an empty `<div id="root">` and a 404 on
 * `/lessons.html`, while `main` built all of it correctly. Nobody saw it until a deploy
 * was attempted, because nothing local looked at the file.
 *
 * The reasoning those comments carried now lives in web/README.md under
 * "`vercel.json` holds data only, and that is deliberate".
 *
 * `functions` is checked only if present. A branch that adds a serverless function adds
 * the block, and the same rule applies to it, but its absence is not a defect.
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
  source?: string;
  headers?: { key?: string; value?: string }[];
}

describe('vercel.json', () => {
  it('carries no // comment keys anywhere', () => {
    // Vercel documents a `//` comment convention for some config files, but this schema
    // forbids additional properties and a nested one has demonstrably broken the build.
    // There is no evidence a top-level one is stripped either, so none are used and
    // web/README.md carries the prose instead.
    const found = commentKeys(doc);
    expect(found, `// comment keys are not allowed in vercel.json: ${found.map((p) => p.join('.')).join(', ')}`).toEqual([]);
  });

  it('keeps the two cache rules the app depends on', () => {
    const headers = doc.headers as Required<HeaderRule>[];
    const bySource = new Map(headers.map((h) => [h.source, h.headers]));
    // Fingerprinted assets can never change meaning.
    expect(bySource.get('/assets/(.*)')?.at(0)).toEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
    // The generated guides must not be immutable, or an edit to lesson copy never lands.
    const pages = [...bySource.entries()].find(([s]) => s.includes('lessons'));
    expect(pages, 'the generated-pages cache rule is gone').toBeTruthy();
    expect(pages?.[1].at(0)?.value).toBe('public, max-age=0, must-revalidate');
  });

  it('gives every header rule a source and at least one header', () => {
    // `headers` is a list of routes, each with a `source` and its own header list. A rule
    // that lost its `source` would match nothing and silently stop caching.
    for (const rule of doc.headers as HeaderRule[]) {
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
    // functions block here would reference a file that does not exist.
    const fns = doc.functions as Record<string, unknown> | undefined;
    if (!fns) return;
    for (const path of Object.keys(fns)) {
      // existsSync rather than readFileSync, so the failure is this assertion rather than
      // an ENOENT stack trace pointing at the test file.
      const here = fileURLToPath(new URL('../../', import.meta.url));
      expect(existsSync(resolve(here, path)), `${path} is named in vercel.json but is not in the tree`).toBe(true);
    }
  });
});

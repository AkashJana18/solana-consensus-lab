import { describe, expect, it } from 'vitest';
import { installAnalytics, isValidGaId } from '../src/analytics';

const REAL_ID = 'G-MH02XQ9SP4';

/**
 * A DOM stand-in, since these tests run in vitest's node environment and the real question is
 * which side effects happen: which script src is requested, and what is queued before it.
 */
function fakeDom() {
  const scripts: { src: string; async: boolean }[] = [];
  const doc = {
    defaultView: {
      dataLayer: undefined as unknown[] | undefined,
      gtag: undefined as ((...args: unknown[]) => void) | undefined,
    } as unknown as Window,
    // Matches on the id substring, which is how installAnalytics probes for an existing tag.
    querySelector: (sel: string) => {
      // installAnalytics probes with script[src*="<id>"], so the id is inside the quotes.
      const wanted = sel.match(/src\*="([A-Za-z0-9-]+)"/)?.[1];
      return wanted && scripts.some((s) => s.src.includes(wanted)) ? ({} as Element) : null;
    },
    createElement: () => {
      const el = { src: '', async: false };
      return el;
    },
    head: {
      appendChild: (el: { src: string; async: boolean }) => scripts.push(el),
    },
  };
  return {
    doc: doc as unknown as Document,
    scripts,
    calls: () => (doc.defaultView as unknown as { dataLayer: unknown[][] }).dataLayer ?? [],
  };
}

describe('isValidGaId', () => {
  it('accepts a real GA4 id and rejects the shapes a typo produces', () => {
    expect(isValidGaId(REAL_ID)).toBe(true);
    // These are the failures worth catching: a truncated id, a GTM container id, a URL, and
    // the empty string that an unset variable produces.
    for (const bad of [undefined, null, '', '   ', 'G-abc', 'GTM-ABC123', 'UA-12345-1', REAL_ID.toLowerCase(), 'https://x?id=G-ABC123']) {
      expect(isValidGaId(bad as string), String(bad)).toBe(false);
    }
  });
});

describe('installAnalytics', () => {
  it('installs nothing when no id is configured, which is the local default', () => {
    const { doc, scripts, calls } = fakeDom();
    expect(installAnalytics({}, doc)).toBe(false);
    expect(scripts).toHaveLength(0);
    expect(calls()).toHaveLength(0);
  });

  it('installs nothing for an invalid id rather than shipping a broken tag', () => {
    // A malformed id in production would mean a live script tag that silently collects
    // nothing, which is the failure this guards.
    const { doc, scripts } = fakeDom();
    expect(installAnalytics({ VITE_GA_ID: 'not-an-id' }, doc)).toBe(false);
    expect(installAnalytics({ VITE_GA_ID: '   ' }, doc)).toBe(false);
    expect(scripts).toHaveLength(0);
  });

  it('installs the tag and queues js and config before it loads', () => {
    const { doc, scripts, calls } = fakeDom();
    expect(installAnalytics({ VITE_GA_ID: REAL_ID }, doc)).toBe(true);

    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`https://www.googletagmanager.com/gtag/js?id=${REAL_ID}`);
    // async is what keeps a slow or blocked third party from delaying first render.
    expect(scripts[0].async).toBe(true);

    // The queue exists before the tag arrives, which is what makes the call order safe.
    expect(calls()).toHaveLength(2);
    expect(calls()[0][0]).toBe('js');
    expect(calls()[1]).toEqual(['config', REAL_ID]);
  });

  it('is idempotent, so a hot reload cannot double-count page views', () => {
    const { doc, scripts, calls } = fakeDom();
    installAnalytics({ VITE_GA_ID: REAL_ID }, doc);
    installAnalytics({ VITE_GA_ID: REAL_ID }, doc);
    expect(scripts).toHaveLength(1);
    expect(calls()).toHaveLength(2);
  });

  it('works without a window, which is what a non-browser render would look like', () => {
    const headless = { head: { appendChild: () => {} } } as unknown as Document;
    expect(installAnalytics({ VITE_GA_ID: REAL_ID }, headless)).toBe(false);
  });
});

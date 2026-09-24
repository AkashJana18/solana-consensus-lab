import { describe, expect, it } from 'vitest';
import { canCompress, compressScenario, decompressScenario, formatUrlState, fromBase64Url, parseUrlState, toBase64Url, type UrlState } from '../src/url/state';

describe('parseUrlState / formatUrlState', () => {
  it('round-trips every field', () => {
    const st: UrlState = { scenario: 'leader-down', seed: 3, mode: 'compare', tMs: 2500.5, node: 4, tab: 'events', speed: 5, lesson: 'skip-certs', step: 2 };
    const qs = formatUrlState(st);
    expect(qs.startsWith('?')).toBe(true);
    expect(parseUrlState(qs)).toEqual(st);
  });

  it('accepts a search string with or without the leading question mark', () => {
    expect(parseUrlState('?seed=7')).toEqual({ seed: 7 });
    expect(parseUrlState('seed=7')).toEqual({ seed: 7 });
  });

  it('drops invalid values instead of throwing', () => {
    const st = parseUrlState('?mode=bogus&speed=3&seed=-1&t=abc&node=x&tab=nope&step=-2');
    expect(st).toEqual({});
  });

  it('encodes "no selected node" as none', () => {
    expect(formatUrlState({ node: null })).toBe('?node=none');
    expect(parseUrlState('?node=none')).toEqual({ node: null });
  });

  it('keeps time in milliseconds with one decimal', () => {
    expect(formatUrlState({ tMs: 1234.56 })).toBe('?t=1234.6');
    expect(parseUrlState('?t=1234.6').tMs).toBe(1234.6);
  });

  it('prefers the compressed scenario over the builtin name and omits the intro step', () => {
    expect(formatUrlState({ scenario: 'x', s: 'abc' })).toBe('?s=abc');
    expect(formatUrlState({ lesson: 'one-tx', step: -1 })).toBe('?lesson=one-tx');
    expect(formatUrlState({ lesson: 'one-tx', step: 0 })).toBe('?lesson=one-tx&step=0');
  });

  it('returns an empty string when nothing is set', () => {
    expect(formatUrlState({})).toBe('');
  });
});

describe('base64url', () => {
  it('round-trips bytes without padding characters', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const s = toBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect([...fromBase64Url(s)]).toEqual([...bytes]);
  });
});

describe('scenario compression', () => {
  it.skipIf(!canCompress)('round-trips JSON through deflate-raw + base64url', async () => {
    const json = JSON.stringify({ name: 'custom', duration_ms: 5000, validators: { count: 12 }, faults: [] });
    const s = await compressScenario(json);
    expect(s).not.toMatch(/[+/=]/);
    expect(await decompressScenario(s)).toBe(json);
  });
});

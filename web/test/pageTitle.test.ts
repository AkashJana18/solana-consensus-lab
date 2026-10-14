import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/lessons';
import { pageTitle, scenarioTitle } from '../src/util/pageTitle';

describe('scenarioTitle', () => {
  it('turns scenario slugs into something readable in a tab', () => {
    expect(scenarioTitle('happy-path')).toBe('Happy Path');
    expect(scenarioTitle('partition-heal')).toBe('Partition Heal');
    expect(scenarioTitle('offline-25pct')).toBe('Offline 25pct');
  });

  it('leaves single characters alone rather than capitalising them', () => {
    // `20pct` is a suffix, not a word, so "20Pct" would be worse than leaving it alone.
    expect(scenarioTitle('offline-25pct')).toContain('25pct');
  });

  it('survives empty and hyphenated input', () => {
    expect(scenarioTitle('')).toBe('');
    expect(scenarioTitle('--a--')).toBe('a');
  });
});

describe('pageTitle', () => {
  const base = { scenarioName: 'happy-path', mode: 'compare', isCustom: false } as const;

  it('names the scenario and the protocols on a share link', () => {
    expect(pageTitle(base)).toBe('Happy Path · TowerBFT vs Alpenglow · Solana Consensus Lab');
    expect(pageTitle({ ...base, mode: 'alpenglow' })).toBe('Happy Path · Alpenglow · Solana Consensus Lab');
    expect(pageTitle({ ...base, mode: 'tower' })).toBe('Happy Path · TowerBFT · Solana Consensus Lab');
  });

  it('prefers the lesson when one is open', () => {
    for (const lesson of LESSONS) {
      expect(pageTitle({ ...base, lessonId: lesson.id })).toBe(`${lesson.title} · Solana Consensus Lab`);
    }
  });

  it('falls back to the brand on an unknown lesson id', () => {
    // A hand-edited URL must not render "undefined" into the tab.
    expect(pageTitle({ ...base, lessonId: 'nope' })).toBe('Solana Consensus Lab');
  });

  it('says so when the scenario came from a custom JSON link', () => {
    expect(pageTitle({ ...base, isCustom: true })).toBe('Custom scenario · TowerBFT vs Alpenglow · Solana Consensus Lab');
  });
});
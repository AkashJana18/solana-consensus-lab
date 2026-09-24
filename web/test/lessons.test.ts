import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from '../src/lessons';
import { protocolsFor, SPEEDS } from '../src/store/useStore';

const scenarioNames = readdirSync(fileURLToPath(new URL('../../scenarios', import.meta.url)))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('lesson registry', () => {
  it('has five lessons with unique ids', () => {
    expect(LESSONS.length).toBe(5);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) expect(lessonById(l.id)).toBe(l);
    expect(lessonById('nope')).toBeUndefined();
  });

  for (const l of LESSONS) {
    describe(l.id, () => {
      it('uses a shipped scenario, a valid mode and a listed speed', () => {
        expect(scenarioNames).toContain(l.scenario);
        expect(['alpenglow', 'tower', 'compare']).toContain(l.mode);
        expect(SPEEDS as readonly number[]).toContain(l.speed);
        expect(l.steps.length).toBeGreaterThan(0);
        expect(l.intro.length).toBeGreaterThan(0);
        expect(l.outro.length).toBeGreaterThan(0);
      });

      it('has well-formed steps', () => {
        const ids = new Set<string>();
        for (const s of l.steps) {
          expect(ids.has(s.id)).toBe(false);
          ids.add(s.id);
          expect(protocolsFor(l.mode)).toContain(s.protocol);
          if (s.question) {
            expect(s.question.choices.length).toBeGreaterThanOrEqual(2);
            expect(s.question.answer).toBeGreaterThanOrEqual(0);
            expect(s.question.answer).toBeLessThan(s.question.choices.length);
            expect(s.question.explain.length).toBeGreaterThan(0);
          }
          if (s.trigger.type === 'time') expect(s.trigger.atUs).toBeGreaterThan(0);
          if (s.deadlineUs !== undefined) expect(s.deadlineUs).toBeGreaterThan(0);
        }
      });
    });
  }
});

import { lockouts } from './lockouts';
import { oneTx } from './one-tx';
import { skipCerts } from './skip-certs';
import { twentyTwenty } from './twenty-twenty';
import type { Lesson } from './types';
import { votesCost } from './votes-cost';

/** Ordered registry; the picker shows lessons in this order. */
export const LESSONS: readonly Lesson[] = [oneTx, votesCost, skipCerts, lockouts, twentyTwenty];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export type { Lesson, LessonStep, Question } from './types';

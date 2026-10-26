import type { LessonSource } from '@/lib/learn/lessons/closest-source';
import type { LessonToWrite } from '@/lib/learn/lessons/write-lesson';
import type { OfferedFigure } from '@/lib/learn/catalogue/figures';
import { ladderLevel } from './ladder';

/**
 * Teaching a topic level before it is asked about (plan #2546.5).
 *
 * A topic no plan piece teaches, such as one of the business pack's, would
 * otherwise only ever be tested. The first time the session reaches one of
 * its levels it shows a short lesson for that level first, written by the
 * lesson writer (`writeLesson`) from the level's checks: the level in a
 * sentence stands in for the claim, the checks for the mastery checks, and
 * the catalogue section closest to the two is the source it is checked
 * against, as an idea's lesson is.
 *
 * Pure: the store is level-lesson-store.ts, the write
 * inngest/learn/level-lesson.ts.
 */

/** The topic level, as the writer reads it. */
export type LevelToTeach = {
  topicName: string;
  scope: string | null;
  level: number;
  /** The level's two to four checks. */
  descriptor: readonly string[];
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The level in one sentence, which the lesson treats as its claim. */
export function levelClaim(level: LevelToTeach): string {
  return `At level ${level.level} on ${clean(level.topicName)}, someone can ${ladderLevel(level.level).can}.`;
}

/** What the catalogue is searched with: the topic and what meeting the level looks like. */
export function levelSourceQuery(level: LevelToTeach): string {
  return [clean(level.topicName), ...level.descriptor.map(clean)].filter(Boolean).join('. ');
}

/** The lesson writer's input for one topic level. */
export function levelLessonInput(
  level: LevelToTeach,
  source: LessonSource | null,
  sourceFigures: OfferedFigure[] = [],
): LessonToWrite {
  return {
    concept: {
      name: clean(level.topicName),
      claim: levelClaim(level),
      mastery: level.descriptor.map(clean).filter(Boolean),
    },
    trackName: clean(level.topicName),
    unit: null,
    prerequisites: [],
    source,
    sourceFigures,
    level: { level: level.level, can: ladderLevel(level.level).can, scope: level.scope },
  };
}

import type { LaidOutUnit } from '@/lib/learn/lessons/lay-out-unit';
import type { PiecesOutcome } from '@/lib/learn/lessons/pieces';
import type { StepHandler } from './run';

/**
 * The first_lesson step of a subject's preparation (plan #2292.1): when the
 * run ends, the subject's first unit is a set of pieces and the first piece's
 * lessons are written, so the page has something to read at once.
 *
 * It does what the top-up does for a goal's plan, keyed on the subject: lays
 * out unit 1 with the unit's own question (`layOutNextUnit`, which asks
 * `unitGoal`), splits it into pieces and matches them to the territory's cells
 * (`writeUnitPieces`), then writes the lesson of each idea in the first piece
 * (`writeLessonCard`). Later units are laid out and written by the top-up as
 * the person reaches them (`planSubjects` in lib/learn/lessons/plan-store.ts).
 *
 * Safe to call again: each part reads what an earlier call wrote and skips
 * it. Laying out is a chain call of about a minute, so with less time left
 * than that the step pauses and the next call starts it with a full budget.
 * A layout or a split that fails throws, which fails the run where Continue
 * picks it up. A lesson that fails is left for the piece's page, which writes
 * any idea with no lesson when it is opened.
 *
 * Pure apart from its ports, so the tests run it with fakes.
 */

/** Time the chain call and the pieces call after it need, at least. */
export const FIRST_LESSON_LAYOUT_MS = 90_000;
/** Time one round of lessons needs, at least. */
export const FIRST_LESSON_WRITE_MS = 30_000;
/** Lessons written at once, as the top-up writes them. */
export const FIRST_LESSON_CONCURRENCY = 4;

export type FirstUnit = { id: string; title: string; laidOut: boolean };
export type FirstPiece = { id: string; title: string; conceptIds: string[] };

export type FirstLessonPorts = {
  /** The subject's first unit by ordinal, and whether a goal is filed under it; null with no units. */
  firstUnit: (subjectId: string) => Promise<FirstUnit | null>;
  /** Lay out the subject's first unopened unit. */
  layOut: (subjectId: string) => Promise<LaidOutUnit>;
  /** The unit's pieces, in order. */
  pieces: (subjectId: string, unitId: string) => Promise<FirstPiece[]>;
  /** Split the unit into pieces and match them to cells. */
  writePieces: (subjectId: string, unitId: string) => Promise<PiecesOutcome>;
  /** Of these ideas, the ones with a lesson card already, ready or dropped. */
  lessons: (conceptIds: readonly string[]) => Promise<Set<string>>;
  /** Write one idea's lesson and store its card. */
  writeLesson: (
    subjectId: string,
    unitId: string,
    conceptId: string,
  ) => Promise<{ outcome: 'ready' | 'dropped' | 'failed' | 'already'; detail?: string }>;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function firstLessonStep(ports: FirstLessonPorts): StepHandler {
  return async (ctx) => {
    if (ctx.subject.branch) return { state: 'skipped', reason: 'A branch run writes no units.' };
    const subjectId = ctx.subject.id;
    const left = () => ctx.deadline - ctx.now();

    let unit = await ports.firstUnit(subjectId);
    if (!unit) return { state: 'skipped', reason: 'The subject has no units to lay out.' };

    if (!unit.laidOut) {
      if (left() < FIRST_LESSON_LAYOUT_MS) return { state: 'more', summary: `Laying out ${unit.title} next.`, pause: true };
      const laid = await ports.layOut(subjectId);
      if (laid.outcome === 'failed') throw new Error(`Laying out ${unit.title} failed: ${laid.detail}`);
      unit = await ports.firstUnit(subjectId);
      if (!unit?.laidOut) throw new Error('The first unit was not laid out.');
    }

    let pieces = await ports.pieces(subjectId, unit.id);
    if (pieces.length === 0) {
      if (left() < FIRST_LESSON_WRITE_MS) return { state: 'more', summary: `Splitting ${unit.title} next.`, pause: true };
      const written = await ports.writePieces(subjectId, unit.id);
      if (written.outcome === 'failed') throw new Error(`Splitting ${unit.title} into pieces failed: ${written.detail}`);
      pieces = await ports.pieces(subjectId, unit.id);
      if (pieces.length === 0) {
        return { state: 'skipped', reason: `${unit.title} has no ideas of its own to split into pieces.` };
      }
    }

    const unitId = unit.id;
    const unitTitle = unit.title;
    const first = pieces[0]!;
    const have = await ports.lessons(first.conceptIds);
    const due = first.conceptIds.filter((id) => !have.has(id));
    const failed: string[] = [];
    let written = 0;
    for (let start = 0; start < due.length; start += FIRST_LESSON_CONCURRENCY) {
      if (left() < FIRST_LESSON_WRITE_MS) {
        return {
          state: 'more',
          summary: `${plural(pieces.length, 'piece', 'pieces')} in ${unitTitle}; writing the lessons of ${first.title}.`,
          counts: { pieces: pieces.length, lessons: have.size + written },
          pause: true,
        };
      }
      const batch = due.slice(start, start + FIRST_LESSON_CONCURRENCY);
      const results = await Promise.all(
        batch.map((conceptId) =>
          ports.writeLesson(subjectId, unitId, conceptId).catch((error: unknown) => ({
            outcome: 'failed' as const,
            detail: error instanceof Error ? error.message : 'failed',
          })),
        ),
      );
      for (const result of results) {
        if (result.outcome === 'failed') failed.push(result.detail ?? 'failed');
        else written += 1;
      }
    }

    const lessons = have.size + written;
    const missed = failed.length > 0 ? ` ${plural(failed.length, 'lesson', 'lessons')} failed and will be written when the piece is opened: ${failed[0]}` : '';
    return {
      state: 'done',
      summary: `Laid out ${unitTitle} in ${plural(pieces.length, 'piece', 'pieces')}, with ${plural(lessons, 'lesson', 'lessons')} written for ${first.title}.${missed}`,
      counts: { pieces: pieces.length, lessons },
      detail: { unitId, pieceId: first.id },
    };
  };
}

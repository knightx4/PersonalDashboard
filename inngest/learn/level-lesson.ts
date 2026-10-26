import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import { loadOfferableFigures } from '@/lib/learn/catalogue/figures';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { findLessonSource } from '@/lib/learn/lessons/closest-source';
import { WRITE_LESSON_MODEL, writeLesson, type LessonResult } from '@/lib/learn/lessons/write-lesson';
import { levelLessonInput, levelSourceQuery } from '@/lib/learn/levels/level-lesson';
import { loadLessonCell, loadLevelLesson, type LevelLesson } from '@/lib/learn/levels/level-lesson-store';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * Writing the lesson for one topic level (plan #2546.5) when the session
 * reaches a level whose lesson is not written yet. The same writer as an
 * idea's lesson; the result is stored in learn.level_lessons, once per
 * person per level, so opening the level again reads it and makes no call.
 * Lessons are written only with the service role, so this runs here rather
 * than in the page's action; every read and write names the person.
 */

const WRITE_OPERATION: LearnOperation = 'write-level-lesson';
const EMBED_OPERATION: LearnOperation = 'embed-lesson-claim';

/** Postgres's unique violation: another tab stored the level's lesson first. */
const UNIQUE_VIOLATION = '23505';

export type LevelLessonResult = { ok: true; lesson: LevelLesson } | { ok: false; detail: string };

type Ports = {
  learn: LearnSupabaseClient;
  core: SpendClient;
  apiKey: string;
  /** Replaces the lesson call, for the test. */
  write?: typeof writeLesson;
  /** Replaces the catalogue search, for the test. */
  findSource?: typeof findLessonSource;
};

/** The row a written lesson is stored as. Exported for the test. */
export function levelLessonRow(
  userId: string,
  cell: { id: string; topicId: string; level: number },
  result: Exclude<LessonResult, { outcome: 'failed' }>,
  cited: { itemId: string; segmentId: string } | null,
): Record<string, unknown> {
  return {
    user_id: userId,
    cell_id: cell.id,
    topic_id: cell.topicId,
    level: cell.level,
    write_model: WRITE_LESSON_MODEL,
    source_item_id: cited?.itemId ?? null,
    source_segment_id: cited?.segmentId ?? null,
    ...(result.outcome === 'ready'
      ? {
          status: 'ready',
          takeaway: result.card.takeaway,
          context: result.card.context,
          hook: result.card.hook,
          summary: result.card.summary,
          example: result.card.example,
          check_question: result.card.question,
          check_answer: result.card.answer,
          predict_question: result.predict?.question ?? null,
          predict_answer: result.predict?.answer ?? null,
          figures: result.figures,
        }
      : { status: 'dropped', drop_reason: result.reason }),
  };
}

/**
 * The level's lesson: the stored one when there is one, otherwise written
 * now and stored. A lesson the writer would not write is stored as dropped,
 * so it is not paid for again, and comes back with `lesson` null and the
 * reason; a call that failed stores nothing and says why.
 */
export async function writeLevelLessonWith(ports: Ports, userId: string, cellId: string): Promise<LevelLessonResult> {
  const { learn, core } = ports;
  const stored = await loadLevelLesson(learn, userId, cellId);
  if (stored) return { ok: true, lesson: stored };

  const cell = await loadLessonCell(learn, userId, cellId);
  if (!cell) return { ok: false, detail: 'That level is not in your map.' };
  if (cell.descriptor.length === 0) return { ok: false, detail: 'That level has no checks to teach from.' };

  const writeSpend: SpendReport[] = [];
  const embedSpend: SpendReport[] = [];
  const level = { topicName: cell.topicName, scope: cell.scope, level: cell.level, descriptor: cell.descriptor };
  const found = await (ports.findSource ?? findLessonSource)(learn, levelSourceQuery(level), {
    onSpend: (report) => embedSpend.push(report),
  });
  const sourceFigures = found ? await loadOfferableFigures(learn, found.itemId) : [];
  const result = await (ports.write ?? writeLesson)({
    lesson: levelLessonInput(level, found, sourceFigures),
    anthropicApiKey: ports.apiKey,
    onSpend: (report) => writeSpend.push(report),
  });
  // Awaited, so the rows land before the function is frozen.
  for (const report of writeSpend) {
    await recordSpend(core, userId, { module: 'learn', operation: WRITE_OPERATION, model: report.model, usage: report.usage });
  }
  for (const report of embedSpend) {
    await recordSpend(core, userId, { module: 'learn', operation: EMBED_OPERATION, model: report.model, usage: report.usage });
  }
  if (result.outcome === 'failed') return { ok: false, detail: result.detail };

  const cited = result.outcome === 'ready' && result.source && found?.segmentId === result.source.segmentId ? found : null;
  const { error } = await learn.from('level_lessons').insert(levelLessonRow(userId, cell, result, cited));
  if (error && error.code !== UNIQUE_VIOLATION) return { ok: false, detail: `Saving the lesson failed: ${error.message}` };

  const saved = await loadLevelLesson(learn, userId, cellId);
  return saved ? { ok: true, lesson: saved } : { ok: false, detail: 'The lesson was not saved.' };
}

/**
 * The lesson for one topic level, for the session's player (plan #2546.3):
 * read when stored, written and stored when not. Call it from a server action
 * after `requireUser()`, with that user's id and the `cellId` of a
 * `level_lesson` item.
 */
export async function writeLevelLesson(userId: string, cellId: string): Promise<LevelLessonResult> {
  const learn = createLearnServiceSupabase();
  // Read first, so a stored lesson needs no key.
  const stored = await loadLevelLesson(learn, userId, cellId);
  if (stored) return { ok: true, lesson: stored };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'Writing a lesson needs ANTHROPIC_API_KEY to be set.' };
  return writeLevelLessonWith({ learn, core: createCoreServiceSupabase(), apiKey }, userId, cellId);
}

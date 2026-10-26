import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { lessonPredict } from '@/lib/learn/feed/card';
import { readStoredFigures } from '@/lib/learn/figures/registry';
import { needsResolving, pageResolveContext, resolveFigures } from '@/lib/learn/figures/resolve';
import type { LessonView } from '@/lib/learn/lessons/piece-store';
import type { LevelLessonState } from '@/lib/learn/next/choose';
import { territoryOf } from './loader-grade';

/**
 * The lesson for one level of a topic (plan #2546.5), as learn.level_lessons
 * holds it: written once per person per topic level by `writeLevelLesson`
 * (inngest/learn/level-lesson.ts) and read from here every time after. Every
 * query names the person, so the service role reads only their rows.
 */

/** One level's lesson, with what the session shows above it. */
export type LevelLesson = {
  id: string;
  cellId: string;
  topicId: string;
  topicName: string;
  level: number;
  /** Null when the writer would not teach the level; `dropped` then says why. */
  lesson: LessonView | null;
  dropped: string | null;
  read: boolean;
};

/** The topic level a lesson is written for. */
export type LessonCell = {
  id: string;
  topicId: string;
  topicName: string;
  scope: string | null;
  level: number;
  descriptor: string[];
};

export const LEVEL_LESSON_COLUMNS =
  'id, cell_id, topic_id, level, status, takeaway, context, hook, summary, example, check_question, check_answer, predict_question, predict_answer, figures, drop_reason, read_at';

export type LevelLessonRow = {
  id: string;
  cell_id: string;
  topic_id: string;
  level: number;
  status: string;
  takeaway: string | null;
  context: string | null;
  hook: string | null;
  summary: string | null;
  example: string | null;
  check_question: string | null;
  check_answer: string | null;
  predict_question: string | null;
  predict_answer: string | null;
  figures: unknown;
  drop_reason: string | null;
  read_at: string | null;
};

/** A stored row as the session shows it. Pure, and exported for the test. */
export function toLevelLesson(row: LevelLessonRow, topicName: string): LevelLesson {
  const ready = row.status === 'ready' && row.takeaway;
  return {
    id: row.id,
    cellId: row.cell_id,
    topicId: row.topic_id,
    topicName,
    level: row.level,
    lesson: ready
      ? {
          takeaway: row.takeaway as string,
          context: row.context,
          hook: row.hook,
          summary: row.summary,
          example: row.example,
          question: row.check_question,
          answer: row.check_answer,
          predict: lessonPredict(row.predict_question, row.predict_answer),
          figures: readStoredFigures(row.figures),
        }
      : null,
    dropped: ready ? null : (row.drop_reason ?? 'No lesson could be written for this level.'),
    read: row.read_at !== null,
  };
}

/**
 * Where each level's lesson stands, for the chooser, by cell id; a level with
 * none written is left out. One row per level reached, so all are read.
 */
export async function loadLevelLessonStates(
  learn: LearnSupabaseClient,
  userId: string,
): Promise<Map<string, LevelLessonState>> {
  const found = new Map<string, LevelLessonState>();
  const { data, error } = await learn
    .from('level_lessons')
    .select('id, cell_id, status, read_at')
    .eq('user_id', userId);
  if (error) throw new Error(`Reading the levels' lessons failed: ${error.message}`);
  for (const row of (data ?? []) as { id: string; cell_id: string; status: string; read_at: string | null }[]) {
    found.set(row.cell_id, { id: row.id, status: row.status === 'ready' ? 'ready' : 'dropped', read: row.read_at !== null });
  }
  return found;
}

/** The topic level, its checks and its topic, or null when it is not in the person's map. */
export async function loadLessonCell(
  learn: LearnSupabaseClient,
  userId: string,
  cellId: string,
): Promise<LessonCell | null> {
  const { data: cell, error } = await learn
    .from('topic_cells')
    .select('id, topic_id, level, descriptor')
    .eq('id', cellId)
    .or(territoryOf(userId))
    .maybeSingle();
  if (error) throw new Error(`Reading the level failed: ${error.message}`);
  if (!cell) return null;
  const row = cell as { id: string; topic_id: string; level: number; descriptor: string[] | null };
  const { data: topic, error: topicError } = await learn
    .from('topics')
    .select('id, name, scope')
    .eq('id', row.topic_id)
    .or(territoryOf(userId))
    .maybeSingle();
  if (topicError) throw new Error(`Reading the level's topic failed: ${topicError.message}`);
  if (!topic) return null;
  const t = topic as { id: string; name: string; scope: string | null };
  return {
    id: row.id,
    topicId: t.id,
    topicName: t.name,
    scope: t.scope,
    level: row.level,
    descriptor: (row.descriptor ?? []).filter((check) => check.trim() !== ''),
  };
}

/**
 * The stored lesson for one topic level, with its figures' data fetched for
 * the page, or null when none is written yet.
 */
export async function loadLevelLesson(
  learn: LearnSupabaseClient,
  userId: string,
  cellId: string,
): Promise<LevelLesson | null> {
  const { data, error } = await learn
    .from('level_lessons')
    .select(LEVEL_LESSON_COLUMNS)
    .eq('user_id', userId)
    .eq('cell_id', cellId)
    .maybeSingle();
  if (error) throw new Error(`Reading the level's lesson failed: ${error.message}`);
  if (!data) return null;
  const row = data as LevelLessonRow;
  const { data: topic } = await learn.from('topics').select('name').eq('id', row.topic_id).or(territoryOf(userId)).maybeSingle();
  const lesson = toLevelLesson(row, (topic as { name: string } | null)?.name ?? '');
  if (lesson.lesson && needsResolving(lesson.lesson.figures)) {
    lesson.lesson = { ...lesson.lesson, figures: await resolveFigures(lesson.lesson.figures, pageResolveContext(learn)) };
  }
  return lesson;
}

/**
 * Note that the person has been shown the lesson, so the session goes on to
 * the level's question next time rather than teaching it again. Only the
 * first showing is kept. Works on the person's own session.
 */
export async function markLevelLessonRead(learn: LearnSupabaseClient, userId: string, lessonId: string): Promise<void> {
  const { error } = await learn
    .from('level_lessons')
    .update({ read_at: new Date().toISOString() })
    .eq('id', lessonId)
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error(`Noting the lesson as read failed: ${error.message}`);
}

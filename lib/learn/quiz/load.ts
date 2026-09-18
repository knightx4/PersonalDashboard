import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { Quiz, QuizQuestion, QuizSource, QuizStatus } from '@/lib/learn/quiz/model';

/**
 * Reading a quiz back.
 *
 * Every query goes through the session client, so RLS decides what comes back
 * and nothing here filters by user id. A quiz reached by an id that is not
 * yours is a quiz that does not exist, which is what the page wants anyway.
 */

const SOURCE_COLUMNS = 'id, position, note_id, body';
const QUESTION_COLUMNS = 'id, position, source_id, question, expected, response, outcome';

type SourceRow = {
  id: string;
  position: number;
  note_id: string | null;
  body: string | null;
};

type QuestionRow = {
  id: string;
  position: number;
  source_id: string;
  question: string;
  expected: string;
  response: string | null;
  outcome: QuizQuestion['outcome'];
};

type QuizRow = {
  id: string;
  title: string;
  preparing_for: string | null;
  status: QuizStatus;
  created_at: string;
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

function toSource(row: SourceRow): QuizSource {
  return { id: row.id, position: row.position, noteId: row.note_id, body: row.body };
}

function toQuestion(row: QuestionRow): QuizQuestion {
  return {
    id: row.id,
    position: row.position,
    sourceId: row.source_id,
    question: row.question,
    expected: row.expected,
    response: row.response,
    outcome: row.outcome,
  };
}

/** A quiz as the list shows it: what it was for, how it went, and when. */
export type QuizListItem = {
  id: string;
  title: string;
  preparingFor: string | null;
  status: QuizStatus;
  createdAt: string;
  total: number;
  right: number;
  /** Questions not reached yet. What makes a quiz resumable from the list. */
  left: number;
};

/** The most quizzes the list reads. Well past what anybody has. */
const LIST_LIMIT = 100;

/**
 * Your quizzes, the unfinished ones first.
 *
 * Two reads and a count in memory rather than a view: PostgREST cannot count
 * one column's values conditionally, and a quiz's questions are ten rows.
 * Order is unfinished first so a half-done quiz has a way back into it, then
 * newest, which is the only thing left to sort a finished one by.
 */
export async function loadQuizzes(supabase: LearnSupabaseClient): Promise<QuizListItem[]> {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, preparing_for, status, created_at')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading your quizzes', error);

  const rows = (data ?? []) as QuizRow[];
  if (rows.length === 0) return [];

  const { data: questions, error: questionError } = await supabase
    .from('quiz_questions')
    .select('quiz_id, outcome')
    .in(
      'quiz_id',
      rows.map((row) => row.id),
    );

  assertSchemaExposed(questionError, LEARN_SCHEMA);
  if (questionError) throw fail('Reading the quiz questions', questionError);

  const tally = new Map<string, { total: number; right: number; left: number }>();
  for (const row of (questions ?? []) as { quiz_id: string; outcome: QuizQuestion['outcome'] }[]) {
    const count = tally.get(row.quiz_id) ?? { total: 0, right: 0, left: 0 };
    count.total += 1;
    if (row.outcome === 'right') count.right += 1;
    if (row.outcome === null) count.left += 1;
    tally.set(row.quiz_id, count);
  }

  return rows
    .map((row) => {
      const count = tally.get(row.id) ?? { total: 0, right: 0, left: 0 };
      return {
        id: row.id,
        title: row.title,
        preparingFor: row.preparing_for,
        status: row.status,
        createdAt: row.created_at,
        ...count,
      };
    })
    .sort((a, b) => {
      const unfinished = Number(b.left > 0) - Number(a.left > 0);
      return unfinished || b.createdAt.localeCompare(a.createdAt);
    });
}

/** One quiz by id, with its material and its questions in order. */
export async function loadQuiz(
  supabase: LearnSupabaseClient,
  quizId: string,
): Promise<Quiz | null> {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, preparing_for, status, created_at')
    .eq('id', quizId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the quiz', error);
  if (!data) return null;

  const row = data as QuizRow;

  const [{ data: sources, error: sourceError }, { data: questions, error: questionError }] =
    await Promise.all([
      supabase
        .from('quiz_sources')
        .select(SOURCE_COLUMNS)
        .eq('quiz_id', quizId)
        .order('position', { ascending: true }),
      supabase
        .from('quiz_questions')
        .select(QUESTION_COLUMNS)
        .eq('quiz_id', quizId)
        .order('position', { ascending: true }),
    ]);

  assertSchemaExposed(sourceError, LEARN_SCHEMA);
  if (sourceError) throw fail('Reading the quiz material', sourceError);
  assertSchemaExposed(questionError, LEARN_SCHEMA);
  if (questionError) throw fail('Reading the quiz questions', questionError);

  return {
    id: row.id,
    title: row.title,
    preparingFor: row.preparing_for,
    status: row.status,
    createdAt: row.created_at,
    sources: ((sources ?? []) as unknown as SourceRow[]).map(toSource),
    questions: ((questions ?? []) as unknown as QuestionRow[]).map(toQuestion),
  };
}

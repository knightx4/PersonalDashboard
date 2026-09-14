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

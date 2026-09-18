import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Writing a quiz and the material it is over.
 *
 * The quiz row first, then its sources, so a failure part way through leaves a
 * quiz with less material rather than material attached to nothing. Positions
 * are the order they were picked in, fixed here rather than left to how rows
 * come back.
 *
 * No questions are written here. Picking the material and writing the
 * questions are two steps on purpose: the picking screen makes no model call,
 * and a quiz with sources and no questions is the row it ends on.
 */

/** One thing to be quizzed on: a note in the vault, or text that was pasted. */
export type NewQuizSource = { noteId: string } | { body: string };

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

export async function createQuiz(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { title: string; preparingFor: string | null; sources: readonly NewQuizSource[] },
): Promise<string> {
  const { data, error } = await supabase
    .from('quizzes')
    .insert({ user_id: userId, title: input.title, preparing_for: input.preparingFor })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Starting the quiz', error ?? { message: 'no row' });

  const quizId = (data as { id: string }).id;

  const { error: sourceError } = await supabase.from('quiz_sources').insert(
    input.sources.map((source, position) => ({
      user_id: userId,
      quiz_id: quizId,
      position,
      note_id: 'noteId' in source ? source.noteId : null,
      body: 'body' in source ? source.body : null,
    })),
  );

  assertSchemaExposed(sourceError, LEARN_SCHEMA);
  if (sourceError) throw fail('Saving what the quiz is over', sourceError);

  return quizId;
}

/** A question to store, before it has an id. */
export type NewQuizQuestion = {
  sourceId: string;
  question: string;
  expected: string;
};

/**
 * Store a quiz's questions, in the order they will be asked.
 *
 * One insert, so a quiz either has its questions or has none of them. The
 * status column follows from the rows through learn.sync_quiz_status(), which
 * is why nothing here writes it.
 */
export async function writeQuizQuestions(
  supabase: LearnSupabaseClient,
  userId: string,
  quizId: string,
  questions: readonly NewQuizQuestion[],
): Promise<void> {
  if (questions.length === 0) return;

  const { error } = await supabase.from('quiz_questions').insert(
    questions.map((question, position) => ({
      user_id: userId,
      quiz_id: quizId,
      source_id: question.sourceId,
      position,
      question: question.question,
      expected: question.expected,
    })),
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Saving the quiz questions', error);
}

/**
 * Record what somebody wrote for one question, and how it was marked.
 *
 * One question at a time, so a closed tab loses at most the one being typed.
 * The quiz's own status follows from these rows through a trigger, which is
 * why nothing here writes it.
 */
export async function answerQuizQuestion(
  supabase: LearnSupabaseClient,
  questionId: string,
  answer: { response: string; correct: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('quiz_questions')
    .update({
      response: answer.response,
      outcome: answer.correct ? 'right' : 'wrong',
      answered_at: new Date().toISOString(),
    })
    .eq('id', questionId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Recording your answer', error);
}

/** Pass on a question. Nothing is stored but the fact that you passed. */
export async function skipQuizQuestion(
  supabase: LearnSupabaseClient,
  questionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('quiz_questions')
    .update({ response: null, outcome: 'skipped', answered_at: new Date().toISOString() })
    .eq('id', questionId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Passing on the question', error);
}

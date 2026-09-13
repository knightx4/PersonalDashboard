import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * The ten questions asked before a subject is built, and what you answered.
 *
 * Reads and writes only. Naming the claims is lib/learn/graph/opening-claims,
 * writing the questions is lib/learn/graph/opening-probe, and what the answers
 * do to generation and to your starting state happens at the two ends of the
 * flow; this is the middle, where a half-finished sweep survives a closed tab.
 *
 * Nothing here touches the graph. A sweep exists before any subject row does --
 * that is what #318 settled -- so the claims are carried as text and the
 * subject id is stamped in later by whoever approves a chain.
 */

/** How one question came out. Null while it is still outstanding. */
export type OpeningOutcome = 'right' | 'wrong' | 'skipped';

/** A question as asked, and what happened to it. */
export type OpeningQuestion = {
  id: string;
  position: number;
  claimName: string;
  claim: string;
  question: string;
  /** The model answer, shown once the question has been answered. */
  expected: string;
  /** What you wrote. Null on one you passed, and on one not reached yet. */
  response: string | null;
  outcome: OpeningOutcome | null;
};

/** One sweep, with its questions in the order they are asked. */
export type OpeningSweep = {
  id: string;
  /** Your words, as typed. */
  asked: string;
  /** The subject the claims were spread across, as the model named it. */
  subjectName: string;
  /** The subject it ended up in, once a chain was approved. */
  subjectId: string | null;
  questions: OpeningQuestion[];
};

/** A question to write, before it has an id. */
export type OpeningQuestionInput = {
  claimName: string;
  claim: string;
  question: string;
  expected: string;
};

const QUESTION_COLUMNS =
  'id, position, claim_name, claim, question, expected, response, outcome';

type QuestionRow = {
  id: string;
  position: number;
  claim_name: string;
  claim: string;
  question: string;
  expected: string;
  response: string | null;
  outcome: OpeningOutcome | null;
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

function toQuestion(row: QuestionRow): OpeningQuestion {
  return {
    id: row.id,
    position: row.position,
    claimName: row.claim_name,
    claim: row.claim,
    question: row.question,
    expected: row.expected,
    response: row.response,
    outcome: row.outcome,
  };
}

/**
 * How many of a sweep's questions have not been reached.
 *
 * A pass counts as reached. Somebody who pressed past all ten has answered the
 * sweep, in the only sense the screen cares about, and showing them nine left
 * would be wrong.
 */
export function outstandingCount(sweep: OpeningSweep): number {
  return sweep.questions.filter((q) => q.outcome === null).length;
}

/** The next question to put on the screen, or null when the sweep is finished. */
export function nextQuestion(sweep: OpeningSweep): OpeningQuestion | null {
  return sweep.questions.find((q) => q.outcome === null) ?? null;
}

/**
 * Write a sweep and its questions.
 *
 * The sweep row first, then the questions, so a failure part way through
 * leaves a sweep with fewer questions rather than questions attached to
 * nothing. Positions are the order they were handed over in, fixed here rather
 * than left to how rows come back.
 */
export async function writeSweep(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { asked: string; subjectName: string; questions: OpeningQuestionInput[] },
): Promise<OpeningSweep> {
  const { data: sweep, error } = await supabase
    .from('opening_sweeps')
    .insert({ user_id: userId, asked: input.asked, subject_name: input.subjectName })
    .select('id, asked, subject_name, subject_id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !sweep) throw fail('Starting the opening questions', error ?? { message: 'no row' });

  const row = sweep as { id: string; asked: string; subject_name: string; subject_id: string | null };

  if (input.questions.length === 0) {
    return { id: row.id, asked: row.asked, subjectName: row.subject_name, subjectId: row.subject_id, questions: [] };
  }

  const { data: written, error: writeError } = await supabase
    .from('opening_questions')
    .insert(
      input.questions.map((question, position) => ({
        user_id: userId,
        sweep_id: row.id,
        position,
        claim_name: question.claimName,
        claim: question.claim,
        question: question.question,
        expected: question.expected,
      })),
    )
    .select(QUESTION_COLUMNS);

  assertSchemaExposed(writeError, LEARN_SCHEMA);
  if (writeError) throw fail('Writing the opening questions', writeError);

  return {
    id: row.id,
    asked: row.asked,
    subjectName: row.subject_name,
    subjectId: row.subject_id,
    questions: ((written ?? []) as unknown as QuestionRow[])
      .map(toQuestion)
      .sort((a, b) => a.position - b.position),
  };
}

/** One sweep by id, with its questions in order. */
export async function loadSweep(
  supabase: LearnSupabaseClient,
  sweepId: string,
): Promise<OpeningSweep | null> {
  const { data, error } = await supabase
    .from('opening_sweeps')
    .select('id, asked, subject_name, subject_id')
    .eq('id', sweepId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the opening questions', error);
  if (!data) return null;

  const row = data as { id: string; asked: string; subject_name: string; subject_id: string | null };

  const { data: questions, error: questionError } = await supabase
    .from('opening_questions')
    .select(QUESTION_COLUMNS)
    .eq('sweep_id', sweepId)
    .order('position', { ascending: true });

  assertSchemaExposed(questionError, LEARN_SCHEMA);
  if (questionError) throw fail('Reading the opening questions', questionError);

  return {
    id: row.id,
    asked: row.asked,
    subjectName: row.subject_name,
    subjectId: row.subject_id,
    questions: ((questions ?? []) as unknown as QuestionRow[]).map(toQuestion),
  };
}

/**
 * The newest sweep for what somebody typed, if there is one.
 *
 * Matched on the words rather than on a subject, because the words are all
 * there is at the point the chain is generated. Case-insensitive, the same as
 * the subject lookup: "keynesian economics" and "Keynesian economics" are one
 * goal.
 */
export async function sweepForGoal(
  supabase: LearnSupabaseClient,
  asked: string,
): Promise<OpeningSweep | null> {
  const { data, error } = await supabase
    .from('opening_sweeps')
    .select('id')
    .ilike('asked', asked)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking for an opening sweep', error);
  if (!data) return null;

  return loadSweep(supabase, (data as { id: string }).id);
}

/**
 * Record what somebody wrote for one question, and how it was graded.
 *
 * One question at a time, so a closed tab loses at most the one being typed.
 */
export async function answerOpeningQuestion(
  supabase: LearnSupabaseClient,
  questionId: string,
  answer: { response: string; correct: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('opening_questions')
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
export async function skipOpeningQuestion(
  supabase: LearnSupabaseClient,
  questionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('opening_questions')
    .update({ response: null, outcome: 'skipped', answered_at: new Date().toISOString() })
    .eq('id', questionId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Passing on the question', error);
}

/**
 * Stamp the subject onto a sweep, once approving a chain has created one.
 *
 * Until this runs the sweep knows only the name the model proposed, which is
 * the shape #318 chose: nothing reaches the graph before you have approved it.
 */
export async function attachSweepToSubject(
  supabase: LearnSupabaseClient,
  sweepId: string,
  subjectId: string,
): Promise<void> {
  const { error } = await supabase
    .from('opening_sweeps')
    .update({ subject_id: subjectId })
    .eq('id', sweepId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Linking the opening questions to the subject', error);
}

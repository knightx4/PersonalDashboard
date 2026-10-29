import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * Dash's questions about the person and what they answered (plan #2617.1),
 * kept in you.dash_questions for the Answer tab of You (you 0033).
 *
 * Dash writes a few questions at a time with why it asked. Each starts open;
 * the person answers it or skips it, and can change an answer afterwards. A
 * skipped question can still be answered. Answered rows are what Dash reads:
 * core.memory_sources embeds them as the you.dash_questions source.
 *
 * Every call names the person as well as relying on row level security, so
 * the same functions serve a service-role client.
 */

export type DashQuestionStatus = 'open' | 'answered' | 'skipped';

export type DashQuestion = {
  id: string;
  question: string;
  why: string | null;
  status: DashQuestionStatus;
  answer: string | null;
  answeredAt: string | null;
  skippedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashQuestionRow = {
  id: string;
  question: string;
  why: string | null;
  status: DashQuestionStatus;
  answer: string | null;
  answered_at: string | null;
  skipped_at: string | null;
  created_at: string;
  updated_at: string;
};

export const DASH_QUESTION_COLUMNS =
  'id, question, why, status, answer, answered_at, skipped_at, created_at, updated_at';

/** The limits the table's checks hold to. */
export const QUESTION_MAX = 300;
export const WHY_MAX = 600;
export const ANSWER_MAX = 4000;

/** Where the questions are answered: the Answer tab of You (plan #2617.2). */
export const ANSWER_HREF = '/you/answer';

export type DashQuestionResult = { ok: true } | { ok: false; error: string };

export function dashQuestionFromRow(row: DashQuestionRow): DashQuestion {
  return {
    id: row.id,
    question: row.question,
    why: row.why,
    status: row.status,
    answer: row.answer,
    answeredAt: row.answered_at,
    skippedAt: row.skipped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Why an answer cannot be saved, or null when it can. */
export function answerError(answer: string): string | null {
  const text = answer.trim();
  if (text === '') return 'Write an answer first, or skip the question.';
  if (text.length > ANSWER_MAX) return `Keep the answer under ${ANSWER_MAX} characters.`;
  return null;
}

/**
 * The tab's two lists: the open questions oldest first, in the order Dash
 * asked them, and the answered and skipped ones with the latest first.
 */
export function splitDashQuestions(questions: readonly DashQuestion[]): {
  open: DashQuestion[];
  past: DashQuestion[];
} {
  const open = questions
    .filter((q) => q.status === 'open')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const when = (q: DashQuestion) => q.answeredAt ?? q.skippedAt ?? q.createdAt;
  const past = questions
    .filter((q) => q.status !== 'open')
    .sort((a, b) => when(b).localeCompare(when(a)) || a.id.localeCompare(b.id));
  return { open, past };
}

/** All their questions, split into open and past. */
export async function loadDashQuestions(
  client: YouSupabaseClient,
  userId: string,
): Promise<{ open: DashQuestion[]; past: DashQuestion[] }> {
  const { data, error } = await client.from('dash_questions').select(DASH_QUESTION_COLUMNS).eq('user_id', userId);
  if (error) throw new Error(`Reading Dash's questions failed: ${error.message}`);
  return splitDashQuestions(((data ?? []) as DashQuestionRow[]).map(dashQuestionFromRow));
}

/**
 * Saves new open questions from Dash, trimmed, leaving out blank ones and
 * any it already has open with the same wording. Returns the new ids.
 */
export async function addDashQuestions(
  client: YouSupabaseClient,
  userId: string,
  questions: readonly { question: string; why?: string | null }[],
): Promise<string[]> {
  const { data: openRows, error: readError } = await client
    .from('dash_questions')
    .select('question')
    .eq('user_id', userId)
    .eq('status', 'open');
  if (readError) throw new Error(`Reading Dash's questions failed: ${readError.message}`);
  const seen = new Set(((openRows ?? []) as { question: string }[]).map((r) => r.question.trim().toLowerCase()));

  const rows: { user_id: string; question: string; why: string | null }[] = [];
  for (const q of questions) {
    const question = q.question.trim().slice(0, QUESTION_MAX);
    const key = question.toLowerCase();
    if (question === '' || seen.has(key)) continue;
    seen.add(key);
    const why = q.why?.trim() ? q.why.trim().slice(0, WHY_MAX) : null;
    rows.push({ user_id: userId, question, why });
  }
  if (rows.length === 0) return [];

  const { data, error } = await client.from('dash_questions').insert(rows).select('id');
  if (error) throw new Error(`Saving Dash's questions failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Answers an open or skipped question. An answered one keeps the day it was
 * first answered; changing its answer is editDashAnswer.
 */
export async function answerDashQuestion(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  answer: string,
  now: Date = new Date(),
): Promise<DashQuestionResult> {
  const problem = answerError(answer);
  if (problem) return { ok: false, error: problem };
  const { data, error } = await client
    .from('dash_questions')
    .update({ status: 'answered', answer: answer.trim(), answered_at: now.toISOString(), skipped_at: null })
    .eq('id', id)
    .eq('user_id', userId)
    .in('status', ['open', 'skipped'])
    .select('id');
  if (error) return { ok: false, error: `Saving your answer failed: ${error.message}` };
  if ((data ?? []).length === 0) return { ok: false, error: 'That question is no longer waiting for an answer.' };
  return { ok: true };
}

/** Skips an open question. It stays on the tab with the past ones and can still be answered. */
export async function skipDashQuestion(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<DashQuestionResult> {
  const { data, error } = await client
    .from('dash_questions')
    .update({ status: 'skipped', skipped_at: now.toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .select('id');
  if (error) return { ok: false, error: `Skipping the question failed: ${error.message}` };
  if ((data ?? []).length === 0) return { ok: false, error: 'That question is no longer open.' };
  return { ok: true };
}

/** Changes the answer to a question already answered. */
export async function editDashAnswer(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  answer: string,
): Promise<DashQuestionResult> {
  const problem = answerError(answer);
  if (problem) return { ok: false, error: problem };
  const { data, error } = await client
    .from('dash_questions')
    .update({ answer: answer.trim() })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'answered')
    .select('id');
  if (error) return { ok: false, error: `Saving your answer failed: ${error.message}` };
  if ((data ?? []).length === 0) return { ok: false, error: 'That question has no answer to change.' };
  return { ok: true };
}

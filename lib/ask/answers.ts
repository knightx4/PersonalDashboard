import { parseRef } from '@/lib/core/refs';
import { AskInputError, clip, readIn, type AskContext, type AskRow, type AskToolResult } from './db';

/**
 * application_answers: every answer on one application with the question it
 * answers (plan #2080.1). Named by the application, or by its role, in which
 * case it is the role's latest attempt, the one save_answer also picks.
 * Read as the signed-in person and filtered to their id.
 */

const TABLE = 'job_search.application_answers';
/**
 * The most of one answer shown, line breaks kept. Answers run to about 2,500
 * characters at most, so this is the whole answer. It was the first 160,
 * with a note to open the rest with open_row, which cannot open this table:
 * asked to fill a question "the way I answered it on another Decagon role",
 * Dash spent all twelve lookups failing to read the other answer and wrote
 * nothing (22 October 2026).
 */
export const ANSWER_CHARS = 6000;

/** An answer as written, line breaks kept, cut only past ANSWER_CHARS. */
function wholeAnswer(text: string | null): string | null {
  if (!text?.trim()) return null;
  const tidy = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return tidy.length <= ANSWER_CHARS ? tidy : `${tidy.slice(0, ANSWER_CHARS).trimEnd()}…`;
}

type Input = Record<string, unknown>;

/** A ref as a lookup returned it: the bare id, or `schema.table:id`. */
function idFrom(input: Input, key: string): string | null {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) return null;
  const ref = value.trim();
  return parseRef(ref)?.id ?? ref;
}

type ApplicationRow = { id: string; role_id: string; attempt: number | null };
type AnswerRow = {
  id: string;
  question_id: string;
  answer: string | null;
  status: string;
  word_limit: number | null;
  created_at: string;
};

export async function applicationAnswersLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const applicationRef = idFrom(input, 'application_ref');
  const roleRef = idFrom(input, 'role_ref');
  if (!applicationRef && !roleRef) throw new AskInputError('Give role_ref or application_ref.');
  if (applicationRef && roleRef) throw new AskInputError('Give role_ref or application_ref, not both.');

  const db = await ctx.db('job_search');
  let application: ApplicationRow | undefined;
  if (applicationRef) {
    const { data, error } = await db
      .from('applications')
      .select('id, role_id, attempt')
      .eq('id', applicationRef)
      .eq('user_id', ctx.userId)
      .limit(1);
    if (error) throw new Error(`applications: ${error.message}`);
    application = ((data ?? []) as ApplicationRow[])[0];
    if (!application) return { ok: false, error: 'No application of theirs has that ref.' };
  } else {
    const { data: roleData, error: roleError } = await db
      .from('roles')
      .select('id')
      .eq('id', roleRef as string)
      .eq('user_id', ctx.userId)
      .limit(1);
    if (roleError) throw new Error(`roles: ${roleError.message}`);
    if (((roleData ?? []) as { id: string }[]).length === 0) return { ok: false, error: 'No role of theirs has that ref.' };
    const { data, error } = await db
      .from('applications')
      .select('id, role_id, attempt')
      .eq('role_id', roleRef as string)
      .eq('user_id', ctx.userId)
      .order('attempt', { ascending: false })
      .limit(1);
    if (error) throw new Error(`applications: ${error.message}`);
    application = ((data ?? []) as ApplicationRow[])[0];
    if (!application) return { ok: true, rows: [], note: 'That role has no application, so no answers.' };
  }

  const { data, error } = await db
    .from('application_answers')
    .select('id, question_id, answer, status, word_limit, created_at')
    .eq('application_id', application.id)
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`application_answers: ${error.message}`);
  const answers = (data ?? []) as AnswerRow[];

  const questions = await readIn<{ id: string; text: string }>(
    db,
    'questions',
    'id, text',
    'id',
    answers.map((a) => a.question_id),
    ctx.userId,
  );
  const questionById = new Map(questions.map((q) => [q.id, q.text]));
  const href = `/jobs/roles/${application.role_id}`;

  const rows: AskRow[] = answers.map((a) => {
    const question = questionById.get(a.question_id) ?? 'A question no longer in the bank';
    return {
      table: TABLE,
      ref: a.id,
      title: clip(question, 200) ?? question,
      href,
      detail: {
        question,
        status: a.status,
        word_limit: a.word_limit,
        answer: wholeAnswer(a.answer),
        application_ref: application.id,
        role_ref: application.role_id,
      },
    };
  });

  return {
    ok: true,
    rows,
    totals: { count: rows.length },
    note:
      rows.length === 0
        ? 'That application has no questions on it yet.'
        : `The ${rows.length} answers on application ${application.id}, each with its question and its whole text. An answer with no text is still empty.`,
  };
}

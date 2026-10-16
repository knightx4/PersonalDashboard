import { questionFingerprint } from '@/lib/jobs/fingerprint';
import { clip, readIn, type AskContext, type AskRow, type AskToolResult } from './db';

/**
 * duplicate_answers (plan #2232.3): the application answers that repeat a
 * question already answered on another role, grouped by the question's
 * fingerprint (lib/jobs/fingerprint.ts), so "Why are you interested in Rogo?"
 * and "1. Why are you interested in Rogo?" fall in one group.
 *
 * It only finds. Removing is propose_delete, which the person confirms.
 * The rules, so that the model does not have to hold them:
 * - A submitted answer is never a row here, so it cannot be proposed; it is
 *   named in the group as a copy that stays. (propose_delete refuses one too.)
 * - One wording in the group: one copy is kept (a submitted one, else an
 *   approved one, else the oldest) and the rest are rows with `remove: true`.
 * - More than one wording: nothing is marked for removal. Every draft copy is
 *   a row with its wording's letter, and the model lists the wordings and asks
 *   which to keep.
 */

const TABLE = 'job_search.application_answers';
const READ_LIMIT = 1000;
const OPENING_CHARS = 160;

type AnswerRow = {
  id: string;
  application_id: string;
  question_id: string;
  answer: string | null;
  status: string;
  created_at: string;
};
type Copy = {
  answer: AnswerRow;
  question: string;
  roleId: string;
  roleTitle: string;
  wording: string;
};

const wordingOf = (text: string | null) => (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const letter = (i: number) => String.fromCharCode(65 + (i % 26));
const describe = (copy: Copy) => `${copy.roleTitle} (${copy.answer.status})`;

export async function duplicateAnswersLookup(ctx: AskContext): Promise<AskToolResult> {
  const db = await ctx.db('job_search');
  const { data, error } = await db
    .from('application_answers')
    .select('id, application_id, question_id, answer, status, created_at')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: true })
    .limit(READ_LIMIT);
  if (error) throw new Error(`application_answers: ${error.message}`);
  const answers = (data ?? []) as AnswerRow[];

  const [questions, applications] = await Promise.all([
    readIn<{ id: string; text: string }>(db, 'questions', 'id, text', 'id', answers.map((a) => a.question_id), ctx.userId),
    readIn<{ id: string; role_id: string }>(db, 'applications', 'id, role_id', 'id', answers.map((a) => a.application_id), ctx.userId),
  ]);
  const roles = await readIn<{ id: string; title: string | null }>(db, 'roles', 'id, title', 'id', applications.map((a) => a.role_id), ctx.userId);
  const questionText = new Map(questions.map((q) => [q.id, q.text]));
  const roleOf = new Map(applications.map((a) => [a.id, a.role_id]));
  const roleTitle = new Map(roles.map((r) => [r.id, r.title ?? 'A role']));

  const groups = new Map<string, Copy[]>();
  for (const answer of answers) {
    const question = questionText.get(answer.question_id);
    const roleId = roleOf.get(answer.application_id);
    if (!question || !roleId) continue;
    const key = questionFingerprint(question);
    const copy: Copy = { answer, question, roleId, roleTitle: roleTitle.get(roleId) ?? 'A role', wording: wordingOf(answer.answer) };
    groups.set(key, [...(groups.get(key) ?? []), copy]);
  }

  const rows: AskRow[] = [];
  const notes: string[] = [];
  let repeated = 0;
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    repeated += 1;
    const question = clip(copies[0].question, 120) ?? copies[0].question;
    const submitted = copies.filter((c) => c.answer.status === 'submitted');
    const drafts = copies.filter((c) => c.answer.status !== 'submitted');
    if (drafts.length === 0) {
      notes.push(`"${question}": every copy is submitted, so none can be removed.`);
      continue;
    }
    const wordings = [...new Set(copies.map((c) => c.wording))];

    const row = (copy: Copy, detail: AskRow['detail']): AskRow => ({
      table: TABLE,
      ref: copy.answer.id,
      title: clip(copy.question, 200) ?? copy.question,
      href: `/jobs/roles/${copy.roleId}`,
      detail: {
        question: copy.question,
        role: copy.roleTitle,
        status: copy.answer.status,
        opening: clip(copy.answer.answer, OPENING_CHARS),
        ...detail,
      },
    });

    if (wordings.length === 1) {
      const keeper = submitted[0] ?? drafts.find((c) => c.answer.status === 'approved') ?? drafts[0];
      const extras = drafts.filter((c) => c !== keeper);
      notes.push(`"${question}": ${copies.length} identical copies, keeps the copy on ${describe(keeper)}, ${extras.length} to remove.`);
      for (const copy of extras) rows.push(row(copy, { remove: true, keeps: describe(keeper), group_copies: copies.length }));
      continue;
    }

    const stay = submitted.length
      ? ` The submitted ${submitted.length === 1 ? 'copy' : 'copies'} on ${submitted.map(describe).join(', ')} stay whatever they choose.`
      : '';
    const listed = wordings
      .map((w, i) => `${letter(i)}: ${copies.filter((c) => c.wording === w).map(describe).join(', ')}`)
      .join('; ');
    notes.push(
      `"${question}": ${copies.length} copies in ${wordings.length} different wordings (${listed}). Nothing is marked for removal: list the wordings and ask which to keep.${stay}`,
    );
    for (const copy of drafts) {
      rows.push(row(copy, { remove: false, wording: letter(wordings.indexOf(copy.wording)), group_copies: copies.length }));
    }
  }

  const truncated = answers.length >= READ_LIMIT ? ` Only the first ${READ_LIMIT} answers were read, so there may be more.` : '';
  return {
    ok: true,
    rows,
    totals: { repeated_questions: repeated, to_remove: rows.filter((r) => r.detail?.remove === true).length },
    note:
      repeated === 0
        ? `No question has an answer on more than one role.${truncated}`
        : `${notes.join(' ')} Submitted answers are never listed. A row with remove true may go to propose_delete; a row with remove false only after they say which wording to keep, and never the one they keep.${truncated}`,
  };
}

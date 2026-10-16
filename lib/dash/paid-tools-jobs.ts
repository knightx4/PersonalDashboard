import { parseRef, toRef } from '@/lib/core/refs';
import { draftAnswerFor, draftApplicationAs, draftCoverLetterFor } from '@/lib/jobs/drafting/run-draft';
import type { DashPaidCheckContext, DashPaidTool } from './registry';

/**
 * Dash's paid tools for the Jobs drafting buttons (plan #2228.3): Draft on one
 * answer, Draft all answers, and Draft a cover letter. Each is declared the
 * way write_year_review is (lib/dash/paid-tools.ts), and calling one queues
 * the press for an approval. Approving it calls the function the button's
 * server action calls (lib/jobs/drafting/run-draft.ts), so the draft and the
 * recorded spend are the button's.
 */

const QUEUED =
  'It costs money, so calling this runs nothing: it is queued on a card under your answer with its estimated cost, and runs only when they approve it.';

const APPLICATIONS = 'job_search.applications';
const ROLES = 'job_search.roles';
const ANSWERS = 'job_search.application_answers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Args = Record<string, unknown>;
type Refusal = { ok: false; error: string };

const asArgs = (input: unknown): Args => (input && typeof input === 'object' ? (input as Args) : {});

/** A ref as a lookup returned it, bare or `schema.table:id`, when it is an id. */
function idOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ref = value.trim();
  const id = parseRef(ref)?.id ?? ref;
  return UUID.test(id) ? id : null;
}

const NOT_SEEN = (table: string, ref: string) =>
  `No lookup in this conversation returned ${table} ${ref}. Look it up first and use the ref it gives.`;

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/** "Designer at Acme", for a line on the card. */
async function roleLine(ctx: DashPaidCheckContext, roleId: string): Promise<string | null> {
  const jobs = await ctx.db('job_search');
  const [role] = await rows<{ title: string; companies: { name: string } | null }>(
    jobs.from('roles').select('title, companies ( name )').eq('id', roleId).eq('user_id', ctx.userId).limit(1),
  );
  if (!role) return null;
  return role.companies?.name ? `${role.title} at ${role.companies.name}` : role.title;
}

/**
 * The application a draft goes on, from the application or role ref a lookup
 * returned. A role is taken by its latest application, the one its page shows.
 */
async function applicationOf(
  ctx: DashPaidCheckContext,
  input: Args,
): Promise<{ ok: true; applicationId: string; roleId: string; role: string } | Refusal> {
  if (!ctx.enabledModules.includes('jobs')) {
    return { ok: false, error: 'The Jobs workspace is switched off, so nothing can be drafted there.' };
  }
  const applicationRef = idOf(input.application_ref);
  const roleRef = idOf(input.role_ref);
  if (!applicationRef && !roleRef) return { ok: false, error: 'Give application_ref or role_ref, as a lookup returned it.' };
  if (applicationRef && roleRef) return { ok: false, error: 'Give application_ref or role_ref, not both.' };

  const jobs = await ctx.db('job_search');
  let found: { id: string; role_id: string } | undefined;
  if (applicationRef) {
    if (!ctx.seen(APPLICATIONS, applicationRef)) return { ok: false, error: NOT_SEEN(APPLICATIONS, applicationRef) };
    [found] = await rows<{ id: string; role_id: string }>(
      jobs.from('applications').select('id, role_id').eq('id', applicationRef).eq('user_id', ctx.userId).limit(1),
    );
  } else {
    if (!ctx.seen(ROLES, roleRef as string)) return { ok: false, error: NOT_SEEN(ROLES, roleRef as string) };
    [found] = await rows<{ id: string; role_id: string }>(
      jobs
        .from('applications')
        .select('id, role_id')
        .eq('role_id', roleRef as string)
        .eq('user_id', ctx.userId)
        .order('attempt', { ascending: false })
        .limit(1),
    );
  }
  if (!found) return { ok: false, error: 'That is not an application of theirs, or the role has none yet.' };
  const role = await roleLine(ctx, found.role_id);
  if (!role) return { ok: false, error: 'That role is not one of theirs, or it has been deleted.' };
  return { ok: true, applicationId: found.id, roleId: found.role_id, role };
}

const REPLIES_NOTE =
  'Replies to Dash\'s earlier questions on the draft are the person\'s to give on the role page, where the Redraft button uses them.';

/** The Draft button on one question of an application (plan #2130.3). */
export const draftAnswerTool: DashPaidTool = {
  name: 'draft_answer',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/roles/actions.ts#draftAnswerFromEvidence',
  runs: 'lib/jobs/drafting/run-draft.ts#draftAnswerFor',
  workspace: 'jobs',
  definition: {
    name: 'draft_answer',
    description: `Draft the answer to one question on a job application from everything on file: the evidence bank, the posting and their other answers. The draft is kept beside the answer for them to read, insert and save; nothing is written onto the application. Call it once for each question they want drafted, with the answer_ref application_answers returned. For every unanswered question at once, use draft_application_answers. ${REPLIES_NOTE} ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        answer_ref: {
          type: 'string',
          description: 'The ref of the answer row, job_search.application_answers:<id>, as the application_answers lookup returned it.',
        },
      },
      required: ['answer_ref'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    if (!ctx.enabledModules.includes('jobs')) {
      return { ok: false, error: 'The Jobs workspace is switched off, so nothing can be drafted there.' };
    }
    const raw = asArgs(input).answer_ref;
    const answerId = idOf(raw);
    if (!answerId) return { ok: false, error: 'answer_ref is missing: give the ref application_answers returned.' };
    if (!ctx.seen(ANSWERS, answerId)) return { ok: false, error: NOT_SEEN(ANSWERS, answerId) };

    const jobs = await ctx.db('job_search');
    const [answer] = await rows<{ id: string; application_id: string; question_id: string }>(
      jobs.from('application_answers').select('id, application_id, question_id').eq('id', answerId).eq('user_id', ctx.userId).limit(1),
    );
    if (!answer) return { ok: false, error: 'That question is not one of theirs.' };
    const [application] = await rows<{ role_id: string }>(
      jobs.from('applications').select('role_id').eq('id', answer.application_id).eq('user_id', ctx.userId).limit(1),
    );
    const [question] = await rows<{ text: string }>(
      jobs.from('questions').select('text').eq('id', answer.question_id).eq('user_id', ctx.userId).limit(1),
    );
    const role = application ? await roleLine(ctx, application.role_id) : null;
    const text = (question?.text ?? 'the question').replace(/\s+/g, ' ').trim();
    const shown = text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
    return {
      ok: true,
      args: { answerId },
      line: `Draft the answer to "${shown}"${role ? ` on ${role}` : ''}.`,
      paths: application ? [`/jobs/roles/${application.role_id}`] : [],
    };
  },
  async run(ctx, args) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Drafting is not configured.' };
    const answerId = String(args.answerId);
    const result = await draftAnswerFor(ctx.userId, apiKey, answerId);
    if (result.error || !result.draft || !result.applicationId) {
      return { ok: false, error: result.error ?? 'No draft came back.' };
    }
    return {
      ok: true,
      subjectRef: toRef(APPLICATIONS, result.applicationId),
      op: 'update',
      summary: 'Dash drafted the answer and kept it beside the question for them to read.',
    };
  },
};

/** The Draft all answers button on an application (plan #2130.3). */
export const draftApplicationAnswersTool: DashPaidTool = {
  name: 'draft_application_answers',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/roles/actions.ts#draftApplication',
  runs: 'lib/jobs/drafting/run-draft.ts#draftApplicationAs',
  workspace: 'jobs',
  definition: {
    name: 'draft_application_answers',
    description: `Draft the answers to every unanswered question on a job application in one go, from everything on file, so the answers tell different stories. The drafts are kept beside the answers for them to read, insert and save; nothing is written onto the application. Give the application_ref or role_ref a lookup returned. To draft one question, or to redraft one that has an answer, use draft_answer. ${REPLIES_NOTE} ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        application_ref: { type: 'string', description: 'The application, as a lookup returned it.' },
        role_ref: { type: 'string', description: 'Or the role, whose latest application is taken. Not both.' },
      },
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const found = await applicationOf(ctx, asArgs(input));
    if (!found.ok) return found;
    const jobs = await ctx.db('job_search');
    const answers = await rows<{ id: string; answer: string | null }>(
      jobs.from('application_answers').select('id, answer').eq('application_id', found.applicationId).eq('user_id', ctx.userId),
    );
    if (answers.length === 0) {
      return { ok: false, error: `${found.role} has no questions yet. Add them first (add_application_questions).` };
    }
    const open = answers.filter((a) => !a.answer?.trim());
    if (open.length === 0) {
      return { ok: false, error: `Every question on ${found.role} has an answer already. Use draft_answer to redraft one.` };
    }
    return {
      ok: true,
      args: { applicationId: found.applicationId },
      line: `Draft the answers to the ${open.length} unanswered ${open.length === 1 ? 'question' : 'questions'} on ${found.role}.`,
      count: open.length,
      paths: [`/jobs/roles/${found.roleId}`],
    };
  },
  async run(ctx, args) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Drafting is not configured.' };
    const applicationId = String(args.applicationId);
    const result = await draftApplicationAs(ctx.userId, apiKey, { applicationId });
    if (result.error || !result.drafts) return { ok: false, error: result.error ?? 'No drafts came back.' };
    const over = result.flagged.length > 0 ? ` ${result.flagged.length} are still over their limit.` : '';
    const missing = result.missing.length > 0 ? ` ${result.missing.length} came back with no draft.` : '';
    return {
      ok: true,
      subjectRef: toRef(APPLICATIONS, applicationId),
      op: 'update',
      summary: `Dash drafted ${result.drafted.length} ${result.drafted.length === 1 ? 'answer' : 'answers'} and kept them beside the questions for them to read.${over}${missing}`,
    };
  },
};

/** The Draft button on an application's cover letter (plan #2135.2). */
export const draftCoverLetterTool: DashPaidTool = {
  name: 'draft_cover_letter',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/roles/[id]/actions.ts#draftCoverLetter',
  runs: 'lib/jobs/drafting/run-draft.ts#draftCoverLetterFor',
  workspace: 'jobs',
  definition: {
    name: 'draft_cover_letter',
    description: `Draft the cover letter for a job application from everything on file. The letter is kept beside the editor for them to read, insert and save; nothing is written onto the application's cover letter. Give the application_ref or role_ref a lookup returned. ${REPLIES_NOTE} ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        application_ref: { type: 'string', description: 'The application, as a lookup returned it.' },
        role_ref: { type: 'string', description: 'Or the role, whose latest application is taken. Not both.' },
      },
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const found = await applicationOf(ctx, asArgs(input));
    if (!found.ok) return found;
    return {
      ok: true,
      args: { applicationId: found.applicationId },
      line: `Draft the cover letter for ${found.role}.`,
      paths: [`/jobs/roles/${found.roleId}`],
    };
  },
  async run(ctx, args) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Drafting is not configured.' };
    const applicationId = String(args.applicationId);
    const result = await draftCoverLetterFor(ctx.userId, apiKey, { applicationId });
    if (result.error || !result.draft) return { ok: false, error: result.error ?? 'No letter came back.' };
    return {
      ok: true,
      subjectRef: toRef(APPLICATIONS, applicationId),
      op: 'update',
      summary: 'Dash drafted the cover letter and kept it beside the editor for them to read.',
    };
  },
};

/** The Jobs paid tools, in the order the model is sent them. */
export const JOBS_PAID_TOOLS: readonly DashPaidTool[] = [draftAnswerTool, draftApplicationAnswersTool, draftCoverLetterTool];

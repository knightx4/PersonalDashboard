import { parseRef, toRef } from '@/lib/core/refs';
import { draftAnswerFor, draftApplicationAs, draftCoverLetterFor } from '@/lib/jobs/drafting/run-draft';
import { matchRoleRequirementsFor } from '@/lib/jobs/evidence/match-run';
import { findStartupsFor, startOpeningSearchFor, suggestPeopleFor } from '@/lib/jobs/suggest/press';
import type { DashPaidCheckContext, DashPaidRunContext, DashPaidTool } from './registry';

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

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const;

function jobsOff(ctx: DashPaidCheckContext): Refusal | null {
  return ctx.enabledModules.includes('jobs')
    ? null
    : { ok: false, error: 'The Jobs workspace is switched off, so nothing can be searched there.' };
}

/** The id of the person's newest row in a table, by a column, optionally of one kind. */
async function newestId(
  ctx: DashPaidRunContext,
  table: string,
  by: string,
  kind?: string,
): Promise<string | null> {
  const jobs = await ctx.db('job_search');
  let query = jobs.from(table).select('id').eq('user_id', ctx.userId);
  if (kind) query = query.eq('kind', kind);
  const [row] = await rows<{ id: string }>(query.order(by, { ascending: false }).limit(1));
  return row?.id ?? null;
}

/** The Find startups button on Find (plan #2228.3). */
export const findStartupsTool: DashPaidTool = {
  name: 'find_startups',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/find/actions.ts#findStartups',
  runs: 'lib/jobs/suggest/press.ts#findStartupsFor',
  workspace: 'jobs',
  definition: {
    name: 'find_startups',
    description: `Find startups for them to follow: a new shortlist from the YC and Hacker News hiring lists, scored for fit with their aims, then the job boards of what it found. The startups land on Find for them to add to their companies. ${QUEUED}`,
    input_schema: NO_INPUT,
  },
  async prepare(ctx) {
    return (
      jobsOff(ctx) ?? {
        ok: true,
        args: {},
        line: 'Find new startups to follow from the YC and Hacker News hiring lists.',
        paths: ['/jobs/find'],
      }
    );
  },
  async run(ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'The startup search is not configured.' };
    const result = await findStartupsFor(ctx.userId, apiKey);
    if (result.error) return { ok: false, error: result.error };
    if (result.message?.includes('already running')) return { ok: false, error: result.message };
    const id = await newestId(ctx, 'discovery_runs', 'started_at');
    if (!id) return { ok: false, error: 'Dash searched, but the run could not be read back.' };
    return { ok: true, subjectRef: toRef('job_search.discovery_runs', id), op: 'insert', summary: result.message ?? 'Dash searched for startups.' };
  },
};

/** The Suggest people button on Find (plan #2228.3). */
export const suggestPeopleTool: DashPaidTool = {
  name: 'suggest_people',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/find/recommend-actions.ts#suggestPeople',
  runs: 'lib/jobs/suggest/press.ts#suggestPeopleFor',
  workspace: 'jobs',
  definition: {
    name: 'suggest_people',
    description: `Look for new people for them to meet, from their career goals and roles, and add them to the people to meet on Find. Nothing is sent to anyone. ${QUEUED}`,
    input_schema: NO_INPUT,
  },
  async prepare(ctx) {
    return (
      jobsOff(ctx) ?? { ok: true, args: {}, line: 'Look for new people for them to meet.', paths: ['/jobs/find'] }
    );
  },
  async run(ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Suggestions are not configured.' };
    const result = await suggestPeopleFor(ctx.userId, apiKey);
    if (result.error || result.written === 0) {
      return { ok: false, error: result.error ?? result.message ?? 'Dash found no new people worth suggesting right now.' };
    }
    const id = await newestId(ctx, 'suggestions', 'created_at', 'reach_out');
    if (!id) return { ok: false, error: 'Dash made suggestions, but they could not be read back.' };
    return {
      ok: true,
      subjectRef: toRef('job_search.suggestions', id),
      op: 'insert',
      summary: `Dash suggested ${result.written} ${result.written === 1 ? 'person' : 'people'} to meet.`,
    };
  },
};

/** The Search now button on Recommended roles on Find (plan #2228.3). */
export const suggestOpeningsTool: DashPaidTool = {
  name: 'find_openings',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/find/recommend-actions.ts#suggestOpenings',
  runs: 'lib/jobs/suggest/press.ts#startOpeningSearchFor',
  workspace: 'jobs',
  definition: {
    name: 'find_openings',
    description: `Search now for roles that fit them: the boards of companies they follow and the web, read and scored, then shown under Recommended roles on Find. The search starts at once and finishes in a few minutes. ${QUEUED}`,
    input_schema: NO_INPUT,
  },
  async prepare(ctx) {
    return (
      jobsOff(ctx) ?? { ok: true, args: {}, line: 'Search now for roles that fit them.', paths: ['/jobs/find'] }
    );
  },
  async run(ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Suggestions are not configured.' };
    const started = await startOpeningSearchFor(ctx.userId, apiKey);
    if (started.error || !started.runId) {
      return { ok: false, error: started.error ?? started.message ?? 'The search could not be started.' };
    }
    return {
      ok: true,
      subjectRef: toRef('job_search.search_runs', started.runId),
      op: 'insert',
      summary: 'Dash started the search for roles. They show under Recommended roles on Find as it finishes.',
    };
  },
};

/** The Match button on a role's requirements (plan #2228.3). */
export const matchRoleRequirementsTool: DashPaidTool = {
  name: 'match_role_requirements',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/jobs/(app)/roles/[id]/posting-actions.ts#matchRoleRequirements',
  runs: 'lib/jobs/evidence/match-run.ts#matchRoleRequirementsFor',
  workspace: 'jobs',
  definition: {
    name: 'match_role_requirements',
    description: `Match a role's requirements against their evidence bank, and keep the match on the role. The role needs a description whose requirements have been read, and a bank with something in it. Give the role_ref a lookup returned. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: { role_ref: { type: 'string', description: 'The role, as a lookup returned it.' } },
      required: ['role_ref'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const off = jobsOff(ctx);
    if (off) return off;
    const roleId = idOf(asArgs(input).role_ref);
    if (!roleId) return { ok: false, error: 'role_ref is missing: give the ref a lookup returned.' };
    if (!ctx.seen(ROLES, roleId)) return { ok: false, error: NOT_SEEN(ROLES, roleId) };
    const jobs = await ctx.db('job_search');
    const [role] = await rows<{ title: string; requirements: unknown[] | null; companies: { name: string } | null }>(
      jobs.from('roles').select('title, requirements, companies ( name )').eq('id', roleId).eq('user_id', ctx.userId).limit(1),
    );
    if (!role) return { ok: false, error: 'That role is not one of theirs, or it has been deleted.' };
    if (!role.requirements || role.requirements.length === 0) {
      return { ok: false, error: "No requirements have been read from this role's description yet, so there is nothing to match." };
    }
    const label = role.companies?.name ? `${role.title} at ${role.companies.name}` : role.title;
    return {
      ok: true,
      args: { roleId },
      line: `Match the requirements of ${label} against their evidence bank.`,
      paths: [`/jobs/roles/${roleId}`],
    };
  },
  async run(ctx, args) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Matching is not configured.' };
    const roleId = String(args.roleId);
    const result = await matchRoleRequirementsFor(ctx.userId, apiKey, roleId);
    if (result.error || !result.matches) return { ok: false, error: result.error ?? 'No match came back.' };
    return {
      ok: true,
      subjectRef: toRef(ROLES, roleId),
      op: 'update',
      summary: `Dash matched ${result.matches.length} requirements against their evidence bank and kept the match on the role.`,
    };
  },
};

/** The Jobs paid tools, in the order the model is sent them. */
export const JOBS_PAID_TOOLS: readonly DashPaidTool[] = [
  draftAnswerTool,
  draftApplicationAnswersTool,
  draftCoverLetterTool,
  findStartupsTool,
  suggestPeopleTool,
  suggestOpeningsTool,
  matchRoleRequirementsTool,
];

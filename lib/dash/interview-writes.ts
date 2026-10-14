import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskDb } from '@/lib/ask/db';
import type { InterviewChangeInput, InterviewChangeKind } from '@/lib/ask/interview-changes';
import { parseMailRef } from '@/lib/ask/mail';
import { movedColumns, readSubject } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { INTERVIEW_KIND_LABEL, INTERVIEW_KINDS, type InterviewKind } from '@/lib/jobs/interview-kinds';
import { insertInterview, insertInterviewRound, nextRoundNumber } from '@/lib/jobs/interview/rounds';
import { wallClockToInstant } from '@/lib/todo/time';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The interview changes Dash makes when asked (plan #2044):
 *
 *   add_interview_round  a round on a role, with the one conversation in it,
 *                        numbered after the role's other rounds (#2044.1).
 *
 *   link_round_email     an email put on a round, as the page's "add email"
 *                        does (#2044.2). Undo deletes the link row only.
 *
 * The round and its conversation are made by the code the role page's "Add
 * interview" uses (lib/jobs/interview/rounds.ts), so the numbering and the
 * conversation come out the same whoever adds them. The record's row is the
 * round; Undo deletes it, which takes the conversation with it, and is
 * refused once anything has been written on either (roundConversationMoved
 * below, and the round's dependents in lib/core/dash-actions.ts).
 */

const DONE_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

const ROLE = 'job_search.roles';
const APPLICATION = 'job_search.applications';
const ROUND = 'job_search.interview_groups';

/** The longest round name the page takes. */
const LABEL_MAX = 120;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

/** A refusal Dash reads and says in words. */
class Refused extends Error {}

type Args = Record<string, unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

async function one<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

/**
 * The application a round goes on, from the role or application ref a lookup
 * returned. A role is taken by its latest application, the one its page and
 * the board show. Refused when the row is not the person's.
 */
async function applicationFor(
  ctx: DashWriteContext,
  jobs: Awaited<ReturnType<DashWriteContext['db']>>,
  ref: string,
): Promise<{ applicationId: string; roleId: string; roleTitle: string }> {
  const table = [ROLE, APPLICATION].find((t) => ctx.seen(t, ref));
  if (!table || !isUuid(ref)) {
    throw new Refused(
      `No lookup in this conversation returned ${ROLE} or ${APPLICATION} ${ref}. Look it up first and use the ref it gives.`,
    );
  }

  let applicationId: string;
  let roleId: string;
  if (table === APPLICATION) {
    const application = await one<{ id: string; role_id: string }>(
      jobs.from('applications').select('id, role_id').eq('id', ref).eq('user_id', ctx.userId).limit(1),
    );
    if (!application) throw new Refused('That application is not one of theirs.');
    applicationId = application.id;
    roleId = application.role_id;
  } else {
    const { data, error } = await jobs
      .from('applications')
      .select('id, attempt')
      .eq('role_id', ref)
      .eq('user_id', ctx.userId);
    if (error) throw new Error(error.message);
    const latest = ((data ?? []) as { id: string; attempt: number | null }[]).reduce<
      { id: string; attempt: number | null } | null
    >((held, row) => (!held || (row.attempt ?? 0) > (held.attempt ?? 0) ? row : held), null);
    if (!latest) throw new Refused('That role is not one of theirs, or it has no application to add a round to.');
    applicationId = latest.id;
    roleId = ref;
  }

  const role = await one<{ id: string; title: string; companies: { name: string } | null }>(
    jobs.from('roles').select('id, title, companies ( name )').eq('id', roleId).eq('user_id', ctx.userId).limit(1),
  );
  if (!role) throw new Refused('That role is not one of theirs, or it has been deleted.');
  return {
    applicationId,
    roleId,
    roleTitle: `${role.title}${role.companies?.name ? ` at ${role.companies.name}` : ''}`,
  };
}

/** When the round is, from a day and an optional time in the person's zone. */
function scheduleOf(args: Args, timezone: string): { scheduledAt: string | null; timeKnown: boolean; day: string | null } {
  const day = text(args, 'date');
  const time = text(args, 'time');
  if (!day) {
    if (time) throw new Refused('time needs a date: give the day as well, YYYY-MM-DD.');
    return { scheduledAt: null, timeKnown: false, day: null };
  }
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new Refused('date must be a day, YYYY-MM-DD.');
  }
  if (time && !TIME.test(time)) throw new Refused('time must be HH:MM.');
  return { scheduledAt: wallClockToInstant(day, time || '00:00', timezone), timeKnown: time !== '', day };
}

async function addInterviewRound(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('jobs')) {
    throw new Refused('The Jobs workspace is switched off, so nothing can be changed there.');
  }
  const ref = text(args, 'role_ref');
  if (!ref) throw new Refused('role_ref is missing.');
  const kind = text(args, 'kind');
  if (!(INTERVIEW_KINDS as readonly string[]).includes(kind)) {
    throw new Refused(`kind must be one of: ${INTERVIEW_KINDS.join(', ')}.`);
  }
  const label = text(args, 'label');
  if (label.length > LABEL_MAX) throw new Refused(`Keep the round's name under ${LABEL_MAX} characters.`);
  const schedule = scheduleOf(args, ctx.timezone ?? 'UTC');

  const jobs = await ctx.db('job_search');
  const supabase = jobs as unknown as AppSupabaseClient;
  const { applicationId, roleId, roleTitle } = await applicationFor(ctx, jobs, ref);

  const roundNumber = await nextRoundNumber(supabase, { userId: ctx.userId, applicationId });
  const round = await insertInterviewRound(supabase, { userId: ctx.userId, applicationId, label, roundNumber });
  if (!round.id) throw new Error(round.error ?? 'The round was not saved.');
  const interview = await insertInterview(supabase, {
    userId: ctx.userId,
    applicationId,
    groupId: round.id,
    kind,
    scheduledAt: schedule.scheduledAt,
    timeKnown: schedule.timeKnown,
  });
  if (!interview.id) {
    // A round with nothing in it is not what was asked for: take it back.
    await jobs.from('interview_groups').delete().eq('id', round.id).eq('user_id', ctx.userId);
    throw new Error(interview.error ?? 'The interview was not saved.');
  }

  const kindLabel = INTERVIEW_KIND_LABEL[kind as InterviewKind];
  const what = label || kindLabel;
  const when = schedule.day ? `, on ${schedule.day}` : ', with no date set';
  const href = `/jobs/roles/${roleId}`;
  const subjectRef = toRef(ROUND, round.id);
  const input: InterviewChangeInput = {
    verb: 'Added the round',
    what,
    rest: ` as round ${roundNumber} of ${roleTitle}${when}`,
    href,
    where: 'Open the role',
    paths: [href, '/jobs/interviews', '/jobs'],
  };
  return {
    ok: true,
    kind: 'add_interview_round' satisfies InterviewChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef,
    op: 'insert',
    before: null,
    after: await readSubject(ctx.db, subjectRef),
    // The conversation as it was made, so Undo can see whether it was written on.
    undo: { interview_id: interview.id, interview: await readSubject(ctx.db, toRef('job_search.interviews', interview.id)) },
    summary: `Dash added round ${roundNumber}, ${what}, to ${roleTitle}${when}.`,
    row: {
      table: ROUND,
      ref: round.id,
      title: `Round ${roundNumber}: ${what}`,
      href,
      detail: { role: roleTitle, kind: kindLabel, date: schedule.day },
    },
  };
}

/**
 * Why a round Dash added cannot be undone because of its conversation: the
 * person set its date, changed its kind or wrote notes on it since. Null when
 * the conversation is as Dash made it, or gone (the round's own check then
 * decides). What hangs off the conversation, such as an interviewer or a
 * file, is the round's dependents' check in lib/core/dash-actions.ts.
 */
export async function roundConversationMoved(
  db: AskDb,
  undo: Record<string, unknown> | null | undefined,
): Promise<string | null> {
  const id = undo?.interview_id;
  const made = undo?.interview;
  if (typeof id !== 'string' || !made || typeof made !== 'object') return null;
  const current = await readSubject(db, toRef('job_search.interviews', id));
  if (!current) return null;
  return movedColumns(current, made as Record<string, unknown>).length > 0
    ? 'The interview in this round has changed since Dash added it, so undoing would lose that.'
    : null;
}

/**
 * Dash names a round by the role it is on and its number ("round 2"), the
 * numbering add_interview_round reports and the role page shows, since no
 * lookup returns rounds. The role is taken the way add_interview_round takes
 * it, by its latest application.
 */
async function linkRoundEmail(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('jobs')) {
    throw new Refused('The Jobs workspace is switched off, so nothing can be changed there.');
  }
  const ref = text(args, 'role_ref');
  if (!ref) throw new Refused('role_ref is missing.');
  const number = args.round_number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    throw new Refused("round_number must be the round's number on the role, 1 or higher.");
  }
  const mailRef = text(args, 'message_ref');
  if (!mailRef) throw new Refused('message_ref is missing.');
  if (!ctx.seen('gmail', mailRef)) {
    throw new Refused('No search_mail in this conversation returned that email. Find it with search_mail and use the ref it gives.');
  }
  const named = parseMailRef(mailRef);
  if (!named) throw new Refused('message_ref must be the ref search_mail returned for the email.');

  const jobs = await ctx.db('job_search');
  const { applicationId, roleId, roleTitle } = await applicationFor(ctx, jobs, ref);

  const round = await one<{ id: string; label: string | null }>(
    jobs
      .from('interview_groups')
      .select('id, label')
      .eq('application_id', applicationId)
      .eq('round_number', number)
      .eq('user_id', ctx.userId)
      .limit(1),
  );
  if (!round) throw new Refused(`${roleTitle} has no round ${number}.`);

  const message = await one<{ id: string }>(
    jobs
      .from('inbox_messages')
      .select('id')
      .eq('email_account_id', named.accountId)
      .eq('provider_message_id', named.messageId)
      .eq('user_id', ctx.userId)
      .limit(1),
  );
  if (!message) {
    throw new Refused('That email is not in their mailbox here, or has not been brought in yet, so it cannot be attached.');
  }

  const roundName = round.label ? `round ${number}, ${round.label}` : `round ${number}`;
  const existing = await one<{ id: string }>(
    jobs.from('interview_group_messages').select('id').eq('group_id', round.id).eq('message_id', message.id).limit(1),
  );
  if (existing) {
    return { ok: false, error: `That email is already attached to ${roundName} of ${roleTitle}. Nothing was changed; tell them so.` };
  }

  const { data, error } = await jobs
    .from('interview_group_messages')
    .insert({ user_id: ctx.userId, group_id: round.id, message_id: message.id })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'The email was not attached.');
  const linkId = (data as { id: string }).id;

  const href = `/jobs/roles/${roleId}`;
  const subjectRef = toRef('job_search.interview_group_messages', linkId);
  const input: InterviewChangeInput = {
    verb: 'Attached an email to',
    what: roundName,
    rest: ` of ${roleTitle}`,
    href,
    where: 'Open the role',
    paths: [href, '/jobs/interviews', '/jobs'],
  };
  return {
    ok: true,
    kind: 'link_round_email' satisfies InterviewChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef,
    op: 'insert',
    before: null,
    after: await readSubject(ctx.db, subjectRef),
    summary: `Dash attached the email to ${roundName} of ${roleTitle}.`,
    row: {
      table: 'job_search.interview_group_messages',
      ref: linkId,
      title: `Email on ${roundName}`,
      href,
      detail: { role: roleTitle, round: number },
    },
  };
}

/** Runs a write, turning a refusal or a failure into the sentence the model reads. Never throws. */
function guarded(name: string, run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>) {
  return async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Args) : {};
    try {
      return await run(ctx, args);
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message };
      console.error(`dash write ${name} failed`, error);
      return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
    }
  };
}

function tool(
  name: InterviewChangeKind,
  description: string,
  input_schema: Anthropic.Tool['input_schema'],
  run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>,
): DashWriteTool<DashWriteResult> {
  return {
    name,
    kind: 'write',
    definition: { name, description: `${description} ${DONE_NOTE}`, input_schema },
    apply: guarded(name, run),
  };
}

/** The interview write tools, in the order the model is sent them. */
export const INTERVIEW_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  tool(
    'add_interview_round',
    `Add an interview round to one of their roles in Jobs, when they ask ("add a take-home round to the Stripe role", "they want a panel next week"). Name the role by the job_search.roles ref search returned, or the job_search.applications ref job_applications returned; look it up first. The round is numbered after the role's other rounds and holds one interview of the kind given. kind is one of: ${INTERVIEW_KINDS.join(', ')} (take_home is a take-home exercise). Give a label only when they named the round ("Systems design"), and a date only when they gave one; a round with no date shows on the role's page waiting for one.`,
    {
      type: 'object',
      properties: {
        role_ref: { type: 'string', description: 'The job_search.roles or job_search.applications ref a lookup returned.' },
        kind: { type: 'string', enum: [...INTERVIEW_KINDS], description: 'What kind of interview the round is.' },
        label: { type: 'string', description: 'The name they gave the round, only when they gave one.' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The day it is on, YYYY-MM-DD, only when they named one.' },
        time: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'The time on that day, HH:MM, only when they named one.' },
      },
      required: ['role_ref', 'kind'],
      additionalProperties: false,
    },
    addInterviewRound,
  ),
  tool(
    'link_round_email',
    "Attach an email to an interview round on one of their roles in Jobs, when they ask (\"attach the recruiter's invite to round 2\"). Find the email first with search_mail and pass the message ref it returned. Name the round by its role (the job_search.roles or job_search.applications ref a lookup returned) and its number on that role: the number add_interview_round gave, or the one the role page shows. The email is only said to belong to the round; it stays on the role's timeline, and Undo removes just the attachment. If it is already attached this says so and changes nothing.",
    {
      type: 'object',
      properties: {
        role_ref: { type: 'string', description: 'The job_search.roles or job_search.applications ref a lookup returned.' },
        round_number: { type: 'integer', minimum: 1, description: "The round's number on that role." },
        message_ref: { type: 'string', description: 'The ref search_mail returned for the email.' },
      },
      required: ['role_ref', 'round_number', 'message_ref'],
      additionalProperties: false,
    },
    linkRoundEmail,
  ),
];

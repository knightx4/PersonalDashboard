import { sameAs, type DashWriteRuns } from './runs';
import { ROLE_KINDS } from '@/lib/jobs/role-kind';
import type Anthropic from '@anthropic-ai/sdk';
import { PERSPECTIVE_QUESTIONS } from '@/lib/jobs/companies/perspective';
import { bareRef, isUuid, type AskDb, type AskRow, type AskSchema, type SchemaClient } from '@/lib/ask/db';
import type { JobsChangeInput, JobsChangeKind } from '@/lib/ask/jobs-changes';
import { toRef } from '@/lib/core/refs';
import { channelForMessage } from '@/lib/jobs/applications/channel';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import {
  addContact,
  addTouch,
  answerTouch,
  BEFORE_CONTACTED_AGAIN,
  CONTACT_RELATIONSHIPS,
  markContacted,
  markDraftSent,
  saveContactEdit,
  saveTouchEdit,
  suggestedContact,
  TOUCH_CHANNELS,
} from '@/lib/jobs/contacts/edit';
import { ANSWER_STATUSES, countEvidenceUse, saveAnswerEdit, setCanonicalAnswer, type AnswerEdit } from '@/lib/jobs/answers/edit';
import { saveReminderEdit, type ReminderEdit } from '@/lib/jobs/today/reminders';
import { setWaitingDismissal } from '@/lib/jobs/today/waiting';
import {
  acknowledgeEventRows,
  confirmApplicationRow,
  dismissMessageRows,
  reopenApplicationRows,
  restoreMessageRow,
  unacknowledgeEventRows,
} from '@/lib/jobs/review/verdicts';
import {
  addPursuitFromMail,
  declineMessageForApplication,
  linkMessageToApplication,
  LINKED_BY_HAND,
  unlinkMessageFromApplication,
  UNLINKED_BY_HAND,
} from '@/lib/jobs/inbox/role-mail';
import { COMPANY_NAME_MAX, normalisedDomains, renameUpdate, saveCompanyEdit } from '@/lib/jobs/companies/edit';
import { CLASSIFICATIONS, type MessageClassification } from '@/lib/jobs/email/classify';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { fileJobNote } from '@/lib/jobs/notes';
import { descriptionUpdate, saveRoleEdit } from '@/lib/jobs/roles/edit';
import { channelEdit, excitementError, saveApplicationEdit, type ApplicationEdit } from '@/lib/jobs/applications/edit';
import {
  changedRoleFacts,
  factWrites,
  moreCertainOnFile,
  recordRoleFactOrigins,
  type FactOrigin,
  type FactSource,
  type FactWrite,
  type RoleFactField,
} from '@/lib/jobs/fact-origins';
import { APPLICATION_SOURCES, SOURCE_LABELS, TERMINAL_STATUSES, type ApplicationSource, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { slugify } from '@/lib/jobs/slug';
import { guessQuestionKind, questionFingerprint, splitQuestionBlock } from '@/lib/jobs/fingerprint';
import { LATER_UNTIL_HELP, laterUntil, untilWords } from '@/lib/core/snooze-days';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';
import { CAREER_WRITES, companyHeld } from './career-writes';
import { INTERVIEW_EDIT_WRITES } from './interview-edit-writes';
import { JobsRefused } from './jobs-refused';
import { keptApplication, mergeRolesInto, type MergeApplication } from '@/lib/jobs/companies/merge-roles';

/**
 * The Jobs changes an agent makes when asked (plan #1894.6.1, feature
 * #1894.6), the ones the role page and the pipeline let the person make by
 * hand:
 *
 *   change_role         a role's title, location, work mode, seniority,
 *                       posting link and status, description or pay band,
 *                       or the company it is filed under.
 *   change_application  how excited they are about it, how they applied
 *                       (the channel, and who referred them), whether it is
 *                       ready to apply and whether it has a cover letter.
 *
 * and, from a role's application questions and the answer bank (plan
 * #1894.6.8):
 *
 *   add_application_questions  questions an application asks, added to it
 *                       and to the bank (QuestionsUndo; undoApplicationQuestions
 *                       takes the paste back).
 *   save_answer         an answer saved, kept as a draft with what it rests
 *                       on, approved or marked submitted.
 *   set_default_answer the answer reused for a question on every
 *                       application.
 *
 * Drafting an answer with a model stays the role page's, since it spends.
 *
 * and, from the company page (plan #1894.6.2):
 *
 *   change_company      a company's name, priority, research notes, domains,
 *                       industry, headquarters and links.
 *   add_company         a company added from scratch, with its priority and
 *                       details (AddedCompanyUndo; undoAddedCompany takes it
 *                       out again while nothing hangs on it).
 *   merge_roles         fold duplicate roles at one company into the one
 *                       they keep.
 *
 * and, from Jobs Today and a role's timeline (plan #1894.6.3):
 *
 *   change_reminder     a reminder finished, put off to a day, reworded, moved
 *                       to another day, or linked to the email behind it.
 *   change_waiting      a "Waiting on you" row done or put off to a day.
 *
 *
 * and, from Jobs review (plan #1894.6.4.1):
 *
 *   review_application  an application the inbox found confirmed, or a
 *                       closed one reopened by hand.
 *   review_events       flagged events acknowledged, or flagged again.
 *
 * and, from a role's mail (plan #1894.6.5):
 *
 *   change_role_email   an email linked to a role, a suggested one turned down,
 *                       or one taken off a role it was wrongly linked to.
 *
 * and, from Jobs review again (plan #1894.6.4.3):
 *
 *   add_role_from_email  a new role and application made from an email,
 *                       with the email linked to it (RoleFromEmailUndo).
 *                       Linking a review email to a role on file is
 *                       change_role_email's link.
 *
 *
 * and, from the contacts pages and Find (plan #1894.6.6):
 *
 *   change_contact        a contact added or corrected.
 *   change_touch          a touch logged in the outreach log, corrected, or
 *                         marked answered.
 *   mark_suggestion_sent  a suggested person marked as messaged.
 *
 * These three keep what they changed in `undo` (ContactRowsUndo), since a
 * touch moves its contact along and taking out a contact takes everything on
 * it with it; undoContactRows puts them back.
 *
 * Moving a role to another stage is move_roles (lib/dash/bulk-roles.ts), and
 * removing a pursuit deletes rows, which Dash never does.
 *
 * All but the merge name one row as their subject and update it, so the one
 * undo rule in lib/core/dash-actions.ts puts it back from the values kept
 * (#1894.4: an agent's writes go straight in, each listed on Home with an
 * Undo). A role moved to a company that was not on file yet makes that
 * company, as the page's move does; the Undo puts the role back and leaves
 * the company, which then holds nothing.
 *
 * A merge touches many rows: it moves everything on the duplicate roles and
 * their applications onto the one kept, and takes the duplicates out. Its
 * record keeps every row it moved and every row it took out, whole, in
 * `undo` (MergeUndo), and undoRoleMerge puts them all back
 * (MANY_ROW_KINDS in lib/core/dash-actions.ts sends its Undo there).
 *
 * Both Ask and the connector run them, as News's (lib/dash/news-writes.ts):
 * Ask on the person's own clients, the connector on a service-role one for
 * the verified person. The service role passes no row level security, so
 * every row is read by its id and the person's user id before it is changed.
 */

export type JobsWriteEnv = {
  userId: string;
  jobs: SchemaClient;
  /** For the links from todos to a role or an application, which a merge moves. */
  todo: SchemaClient;
  /** For a role's thread, which a merge will not leave behind. */
  core: SchemaClient;
  /** Their IANA zone, for the day a Later ends; UTC when absent. */
  timezone?: string;
};

/** A Jobs change as made, before a surface keeps it. */
export type JobsMade = {
  kind: JobsChangeKind;
  input: JobsChangeInput;
  subjectRef: string;
  /** An insert only for a waiting row put aside the first time (change_waiting). */
  op: 'insert' | 'update';
  /** The row before, for an update; null for an insert. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  summary: string;
  row: AskRow;
  /** Every row a change of many rows touched, which its Undo puts back; null for one row. */
  undo: Record<string, unknown> | null;
};

export type JobsWrite = {
  name: JobsChangeKind;
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: JobsWriteEnv, args: Args) => Promise<JobsMade>;
};

/** A refusal the model reads and says in words. */
export { JobsRefused };

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const ROLES = 'job_search.roles';
const APPLICATIONS = 'job_search.applications';

const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;
const POSTING_STATUSES = ['open', 'closed', 'unknown'] as const;
const PAY_SOURCES = ['posted', 'recruiter', 'estimate'] as const;

const TITLE_MAX = 200;
const COMPANY_MAX = 200;
const FIELD_MAX = 200;
const DESCRIPTION_MAX = 100_000;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether the call names the field at all: a value, an empty string or null. */
function given(args: Args, key: string): boolean {
  return args[key] !== undefined;
}

/** A field that may be cleared: its trimmed text, or null for an empty string or null. */
function clearable(args: Args, key: string, max: number): string | null {
  const value = args[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new JobsRefused(`${key} must be text, or an empty string to clear it.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new JobsRefused(`Keep ${key} under ${max} characters.`);
  return trimmed || null;
}

function oneOf<T extends string>(args: Args, key: string, allowed: readonly T[], nullable: boolean): T | null {
  const value = args[key];
  if ((value === null || value === '') && nullable) return null;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new JobsRefused(`${key} must be one of: ${allowed.join(', ')}${nullable ? ', or an empty string to clear it' : ''}.`);
}

/** A whole amount of money, kept in cents. */
function pay(args: Args, key: string): number | null {
  const value = args[key];
  if (value === null || value === '' || value === 0) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 20_000_000) {
    throw new JobsRefused(`${key} must be a whole yearly amount, such as 150000, or 0 to clear it.`);
  }
  return Math.round(value * 100);
}

function idOf(value: string, what: string): string {
  const id = bareRef(value);
  if (!isUuid(id)) throw new JobsRefused(`That is not a ${what}'s ref, as a lookup returned it.`);
  return id;
}

async function ownRow(client: SchemaClient, table: string, id: string, userId: string, what: string): Promise<Row> {
  const { data, error } = await client.from(table).select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new JobsRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as Row;
}

async function companyName(env: JobsWriteEnv, id: unknown): Promise<string | null> {
  if (typeof id !== 'string') return null;
  const { data } = await env.jobs.from('companies').select('name').eq('id', id).eq('user_id', env.userId).maybeSingle();
  const name = (data as Row | null)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** "Data Engineer at Acme", the way the role page heads itself. */
function roleName(role: Row, company: string | null): string {
  const title = typeof role.title === 'string' && role.title.trim() ? role.title.trim() : 'the role';
  const line = company ? `${title} at ${company}` : title;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

/** "a, b and c". */
function listed(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const roleHref = (id: string) => `/jobs/roles/${id}`;
const rolePaths = (id: string) => ['/jobs', '/jobs/roles', '/jobs/pipeline', '/jobs/companies', roleHref(id)];

// ---------------------------------------------------------------------------
// change_role
// ---------------------------------------------------------------------------

/** The role a call names: by its own ref, or by an application on it. */
async function namedRole(env: JobsWriteEnv, args: Args): Promise<Row> {
  const roleRef = text(args, 'role_ref');
  if (roleRef) return ownRow(env.jobs, 'roles', idOf(roleRef, 'role'), env.userId, 'role');
  const applicationRef = text(args, 'application_ref');
  if (!applicationRef) throw new JobsRefused('Name the role: role_ref, or application_ref for one of its applications.');
  const application = await ownRow(env.jobs, 'applications', idOf(applicationRef, 'application'), env.userId, 'application');
  return ownRow(env.jobs, 'roles', application.role_id as string, env.userId, 'role');
}

const FACT_SOURCES = ['posting', 'email', 'person', 'guess'] as const;

const FACT_WORDS: Record<RoleFactField, string> = {
  comp: 'The pay on file',
  location: 'The location on file',
  work_mode: 'The work mode on file',
  seniority: 'The seniority on file',
  posting_status: 'Whether the posting is open',
};

const ORIGIN_WORDS: Record<FactOrigin, string> = {
  posting: 'the posting',
  recruiter_email: "a recruiter's email",
  dash: 'Dash',
  you: 'them',
  unknown: 'somewhere unrecorded',
};

/**
 * Where the facts a change_role call sets came from (plan #2343.2). Dash's
 * write records Dash, firsthand when it quotes the posting, secondhand and
 * linked to the email when it quotes one, and a guess otherwise; what the
 * person told Dash in so many words is theirs and firsthand. Without a
 * fact_source, pay takes the certainty of its pay_source, and a band read
 * from a description Dash was given came from that posting text.
 */
async function dashFactWrites(env: JobsWriteEnv, args: Args, before: Row, update: Row): Promise<FactWrite[]> {
  const factSource = given(args, 'fact_source') ? oneOf(args, 'fact_source', FACT_SOURCES, false) : null;
  let messageId: string | null = null;
  if (factSource === 'email') {
    let ref = text(args, 'email_ref');
    if (ref.startsWith('job_search.inbox_messages:')) ref = ref.slice('job_search.inbox_messages:'.length);
    if (!ref) throw new JobsRefused('fact_source email needs email_ref: the email the values were read from.');
    messageId = (await namedEmail(env, ref)).id as string;
  } else if (given(args, 'email_ref')) {
    throw new JobsRefused('email_ref goes with fact_source "email".');
  }
  const postingUrl = (('jd_url' in update ? update.jd_url : before.jd_url) as string | null) ?? null;
  const bandFromDescription = given(args, 'description') && !given(args, 'pay_min') && !given(args, 'pay_max') && update.comp_source === 'posted';
  const paySource = 'comp_source' in update ? update.comp_source : before.comp_source;

  return factWrites(changedRoleFacts(before, update), (field): FactSource => {
    switch (factSource) {
      case 'person':
        return { origin: 'you', certainty: 'firsthand' };
      case 'posting':
        return { origin: 'dash', certainty: 'firsthand', sourceUrl: postingUrl };
      case 'email':
        return { origin: 'dash', certainty: 'secondhand', messageId };
      case 'guess':
        return { origin: 'dash', certainty: 'guess' };
    }
    if (field === 'comp' && (bandFromDescription || (given(args, 'pay_source') && paySource === 'posted'))) {
      return { origin: 'dash', certainty: 'firsthand', sourceUrl: postingUrl };
    }
    if (field === 'comp' && given(args, 'pay_source') && paySource === 'recruiter') return { origin: 'dash', certainty: 'secondhand' };
    return { origin: 'dash', certainty: 'guess' };
  });
}

async function changeRole(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await namedRole(env, args);
  const id = before.id as string;
  const update: Row = {};
  const changed: string[] = [];

  if (given(args, 'title')) {
    const title = text(args, 'title');
    if (!title) throw new JobsRefused('A role needs a title: give the new one, or leave title out.');
    if (title.length > TITLE_MAX) throw new JobsRefused(`Keep the title under ${TITLE_MAX} characters.`);
    if (title !== before.title) {
      update.title = title;
      changed.push('the title');
    }
  }
  if (given(args, 'location')) {
    update.location = clearable(args, 'location', FIELD_MAX);
    changed.push('the location');
  }
  if (given(args, 'work_mode')) {
    update.work_mode = oneOf(args, 'work_mode', WORK_MODES, true);
    changed.push('the work mode');
  }
  if (given(args, 'seniority')) {
    update.seniority = clearable(args, 'seniority', FIELD_MAX);
    changed.push('the seniority');
  }
  if (given(args, 'kind')) {
    update.kind = oneOf(args, 'kind', ROLE_KINDS, false);
    changed.push('the kind');
  }
  if (given(args, 'posting_status')) {
    update.posting_status = oneOf(args, 'posting_status', POSTING_STATUSES, false);
    changed.push('whether the posting is open');
  }
  if (given(args, 'posting_url')) {
    const url = clearable(args, 'posting_url', 2000);
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new JobsRefused('posting_url is not a web link starting http:// or https://.');
    update.jd_url = url;
    changed.push('the posting link');
  }

  const payGiven = given(args, 'pay_min') || given(args, 'pay_max') || given(args, 'pay_source');
  if (given(args, 'pay_min')) update.comp_min_cents = pay(args, 'pay_min');
  if (given(args, 'pay_max')) update.comp_max_cents = pay(args, 'pay_max');
  if (given(args, 'pay_source')) update.comp_source = oneOf(args, 'pay_source', PAY_SOURCES, true);
  if (payGiven) changed.push('the pay');

  if (given(args, 'description')) {
    // As the role page saves a pasted description (lib/jobs/roles/edit.ts).
    const description = clearable(args, 'description', DESCRIPTION_MAX);
    Object.assign(update, descriptionUpdate(description, given(args, 'pay_min') || given(args, 'pay_max')).update);
    changed.push('the description');
  }

  const min = 'comp_min_cents' in update ? update.comp_min_cents : before.comp_min_cents;
  const max = 'comp_max_cents' in update ? update.comp_max_cents : before.comp_max_cents;
  if (typeof min === 'number' && typeof max === 'number' && max < min) {
    throw new JobsRefused('The top of the pay band is below the bottom. Check the two numbers.');
  }

  let movedTo: string | null = null;
  if (given(args, 'company')) {
    const name = text(args, 'company');
    if (!name) throw new JobsRefused('company is empty: give the name of the company the role belongs to.');
    if (name.length > COMPANY_MAX) throw new JobsRefused(`Keep the company name under ${COMPANY_MAX} characters.`);
    const company = await ensureCompany(env.jobs as unknown as AppSupabaseClient, env.userId, name);
    if (company.error) throw new Error(`Finding the company failed: ${company.error}`);
    if (company.id !== before.company_id) {
      update.company_id = company.id;
      movedTo = name;
      changed.push(`the company, to ${name}`);
    }
  }

  const priority = given(args, 'company_priority') ? oneOf(args, 'company_priority', PRIORITIES, false) : null;
  if (Object.keys(update).length === 0 && !priority) {
    throw new JobsRefused('Nothing to change: give at least one field with its new value.');
  }

  let after = before;
  if (Object.keys(update).length > 0) {
    const origins = await dashFactWrites(env, args, before, update);
    const factsDb = env.jobs as unknown as AppSupabaseClient;
    const firmer = await moreCertainOnFile(factsDb, env.userId, id, origins);
    if (firmer.length > 0) {
      const kept = firmer.map((fact) => `${FACT_WORDS[fact.field]} came from ${ORIGIN_WORDS[fact.origin]} (${fact.certainty})`);
      throw new JobsRefused(
        `${listed(kept)}, and a less certain value does not replace it. Leave it out, or give fact_source posting, email or person when the new value comes from one of those.`,
      );
    }

    // The same write as the role page's edit, rename and move.
    const { row: data, error } = await saveRoleEdit(factsDb, env.userId, id, update);
    if (error?.code === '23505') throw new JobsRefused(error.message);
    if (error || !data) throw new Error(`Changing the role failed: ${error?.message ?? 'no row'}`);

    try {
      await recordRoleFactOrigins(factsDb, env.userId, id, origins);
    } catch (originError) {
      console.error('change_role: recording where the facts came from failed', originError);
    }
    after = data as Row;
  }
  // The priority is the company's, so the role's Undo leaves it.
  if (priority) {
    const { error } = await env.jobs
      .from('companies')
      .update({ priority })
      .eq('id', after.company_id as string)
      .eq('user_id', env.userId);
    if (error) throw new Error(`Marking the company failed: ${error.message}`);
    changed.push(`its company's priority, to ${priority}`);
  }
  const was = roleName(before, await companyName(env, before.company_id));
  const now = movedTo ? roleName(after, movedTo) : roleName(after, await companyName(env, after.company_id));
  const href = roleHref(id);
  return {
    kind: 'change_role',
    input: { verb: 'Changed', what: now, rest: `: ${listed(changed)}`, href, where: 'Open the role', paths: rolePaths(id) },
    subjectRef: toRef(ROLES, id),
    op: 'update',
    before,
    after,
    summary: `Dash changed ${listed(changed)} on the role ${was}.`,
    row: { table: ROLES, ref: id, title: now, href },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// change_application
// ---------------------------------------------------------------------------

/** The application a call names: by its own ref, or the latest one on a role, the one the board shows. */
async function namedApplication(env: JobsWriteEnv, args: Args): Promise<Row> {
  const applicationRef = text(args, 'application_ref');
  if (applicationRef) return ownRow(env.jobs, 'applications', idOf(applicationRef, 'application'), env.userId, 'application');
  const roleRef = text(args, 'role_ref');
  if (!roleRef) throw new JobsRefused('Name the application: application_ref, or role_ref for the role it is on.');
  const role = await ownRow(env.jobs, 'roles', idOf(roleRef, 'role'), env.userId, 'role');
  const { data, error } = await env.jobs
    .from('applications')
    .select('*')
    .eq('role_id', role.id as string)
    .eq('user_id', env.userId)
    .order('attempt', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading the application failed: ${error.message}`);
  const latest = (data as Row[] | null)?.[0];
  if (!latest) throw new JobsRefused('That role has no application to change.');
  return latest;
}

async function changeApplication(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await namedApplication(env, args);
  const id = before.id as string;
  const update: ApplicationEdit = {};
  const changed: string[] = [];

  if (given(args, 'excitement')) {
    const value = args.excitement === 0 ? null : args.excitement;
    if (value !== null && (typeof value !== 'number' || excitementError(value))) {
      throw new JobsRefused('excitement runs from 1 to 5, or 0 to clear it.');
    }
    update.excitement = value;
    changed.push(value === null ? 'cleared how excited they are' : `set how excited they are to ${value} of 5`);
  }

  if (given(args, 'channel')) {
    const channel = oneOf(args, 'channel', APPLICATION_SOURCES, false) as ApplicationSource;
    let referral: string | null = null;
    if (channel === 'referral' && text(args, 'referral_contact_ref')) {
      const contact = await ownRow(env.jobs, 'contacts', idOf(text(args, 'referral_contact_ref'), 'contact'), env.userId, 'contact');
      referral = contact.id as string;
    }
    // As the page sets it: any channel but a referral clears who referred them.
    Object.assign(update, channelEdit(channel, referral));
    changed.push(`set how they applied to ${SOURCE_LABELS[channel]}`);
  } else if (given(args, 'referral_contact_ref')) {
    throw new JobsRefused('referral_contact_ref goes with channel "referral".');
  }

  if (given(args, 'ready_to_apply')) {
    if (typeof args.ready_to_apply !== 'boolean') throw new JobsRefused('ready_to_apply is true or false.');
    update.ready_to_apply = args.ready_to_apply;
    changed.push(args.ready_to_apply ? 'marked it ready to apply' : 'marked it not ready to apply');
  }

  if (given(args, 'all_questions_added')) {
    if (typeof args.all_questions_added !== 'boolean') throw new JobsRefused('all_questions_added is true or false.');
    update.all_questions_added = args.all_questions_added;
    changed.push(args.all_questions_added ? 'marked that all its questions are added' : 'marked that not all its questions are added');
  }

  if (given(args, 'has_cover_letter')) {
    const value = args.has_cover_letter;
    if (value !== null && typeof value !== 'boolean') {
      throw new JobsRefused('has_cover_letter is true, false, or null to clear it.');
    }
    update.has_cover_letter = value;
    changed.push(
      value === null
        ? 'cleared whether it has a cover letter'
        : value
          ? 'marked that it has a cover letter'
          : 'marked that it has no cover letter',
    );
  }

  if (Object.keys(update).length === 0) {
    throw new JobsRefused('Nothing to change: give excitement, channel, ready_to_apply, all_questions_added or has_cover_letter.');
  }

  // The same write as the pipeline's pickers and the role page's marks.
  const saved = await saveApplicationEdit(env.jobs as unknown as AppSupabaseClient, env.userId, id, update);
  if (saved.error) throw new Error(`Changing the application failed: ${saved.error}`);
  const data = await ownRow(env.jobs, 'applications', id, env.userId, 'application');

  const roleId = before.role_id as string;
  const role = await ownRow(env.jobs, 'roles', roleId, env.userId, 'role');
  const name = roleName(role, await companyName(env, role.company_id));
  const href = roleHref(roleId);
  const said = listed(changed);
  return {
    kind: 'change_application',
    input: { verb: 'Changed', what: name, rest: `: ${said}`, href, where: 'Open the role', paths: [...rolePaths(roleId), '/jobs/analytics'] },
    subjectRef: toRef(APPLICATIONS, id),
    op: 'update',
    before,
    after: data as Row,
    summary: `Dash ${said} for the role ${name}.`,
    row: { table: ROLES, ref: roleId, title: name, href },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// add_application_questions, save_answer, set_default_answer
// ---------------------------------------------------------------------------

const QUESTIONS = 'job_search.questions';
const ANSWERS = 'job_search.application_answers';
const MATERIAL_HREF = '/jobs/material';
const CONSIDERATIONS_MAX = 10;
const QUESTIONS_MAX = 30;
const QUESTION_MAX = 2000;
const ANSWER_MAX = 20_000;
const CLAIMS_MAX = 20;

/**
 * What add_application_questions keeps so its Undo can take the paste back:
 * the answer rows it added to the application, the questions it added to the
 * bank, and the questions already in the bank whose count of times seen it
 * raised.
 */
export type QuestionsUndo = {
  answers: string[];
  created: string[];
  seen: { id: string; before: number; after: number }[];
};

/** "Why do you want to work here?", cut to a line. */
function questionLine(value: unknown): string {
  const line = typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : 'the question';
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** The questions a call gives: a list, or one pasted block split as the role page splits it. */
function questionTexts(args: Args): string[] {
  const value = args.questions;
  const texts =
    typeof value === 'string'
      ? splitQuestionBlock(value)
      : Array.isArray(value)
        ? value.map((entry) => (typeof entry === 'string' ? entry.trim().replace(/\s+/g, ' ') : '')).filter(Boolean)
        : [];
  if (texts.length === 0) throw new JobsRefused('Give the questions: a list, or the block as the form shows it.');
  if (texts.length > QUESTIONS_MAX) throw new JobsRefused(`Up to ${QUESTIONS_MAX} questions at a time.`);
  if (texts.some((t) => t.length > QUESTION_MAX)) throw new JobsRefused(`Keep each question under ${QUESTION_MAX} characters.`);
  return texts;
}

async function addApplicationQuestions(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const application = await namedApplication(env, args);
  const applicationId = application.id as string;
  const texts = questionTexts(args);

  const { data: onIt, error: onItError } = await env.jobs
    .from('application_answers')
    .select('question_id')
    .eq('application_id', applicationId)
    .eq('user_id', env.userId);
  if (onItError) throw new Error(`Reading the application's questions failed: ${onItError.message}`);
  const already = new Set(((onIt ?? []) as Row[]).map((row) => row.question_id as string));

  const undo: QuestionsUndo = { answers: [], created: [], seen: [] };
  const added: string[] = [];
  let skipped = 0;
  try {
    for (const text of texts) {
      const fingerprint = questionFingerprint(text);
      const { data: existing, error: readError } = await env.jobs
        .from('questions')
        .select('id, times_seen')
        .eq('user_id', env.userId)
        .eq('fingerprint', fingerprint)
        .limit(1);
      if (readError) throw new Error(`Reading the question bank failed: ${readError.message}`);
      const found = ((existing ?? []) as Row[])[0];
      let questionId: string;
      if (found) {
        questionId = found.id as string;
        // The same question twice on one application is one row, as a second paste of it should be.
        if (already.has(questionId)) {
          skipped += 1;
          continue;
        }
        const before = typeof found.times_seen === 'number' ? found.times_seen : 1;
        const { error } = await env.jobs.from('questions').update({ times_seen: before + 1 }).eq('id', questionId).eq('user_id', env.userId);
        if (error) throw new Error(`Counting the question failed: ${error.message}`);
        undo.seen.push({ id: questionId, before, after: before + 1 });
      } else {
        const { data: created, error } = await env.jobs
          .from('questions')
          .insert({ user_id: env.userId, text, fingerprint, kind: guessQuestionKind(text) })
          .select('id')
          .single();
        if (error || !created) throw new Error(`Adding the question failed: ${error?.message ?? 'no row'}`);
        questionId = (created as Row).id as string;
        undo.created.push(questionId);
      }
      const { data: answer, error: answerError } = await env.jobs
        .from('application_answers')
        .insert({ user_id: env.userId, application_id: applicationId, question_id: questionId })
        .select('id')
        .single();
      if (answerError || !answer) throw new Error(`Adding the question to the application failed: ${answerError?.message ?? 'no row'}`);
      undo.answers.push((answer as Row).id as string);
      already.add(questionId);
      added.push(text);
    }
  } catch (error) {
    // Half a paste is worse than none: take back what went in before the failure.
    await putBackQuestions({ userId: env.userId, jobs: env.jobs }, undo).catch(() => undefined);
    throw error;
  }
  if (added.length === 0) throw new JobsRefused('Those questions are on that application already.');

  const roleId = application.role_id as string;
  const role = await ownRow(env.jobs, 'roles', roleId, env.userId, 'role');
  const name = roleName(role, await companyName(env, role.company_id));
  const href = roleHref(roleId);
  const what = added.length === 1 ? `"${questionLine(added[0])}"` : `${added.length} questions`;
  const also = skipped > 0 ? `, leaving out ${skipped} already on it` : '';
  const firstAnswer = undo.answers[0];
  return {
    kind: 'add_application_questions',
    input: { verb: 'Added', what, rest: ` to the application for ${name}${also}`, href, where: 'Open the role', paths: [...rolePaths(roleId), MATERIAL_HREF] },
    subjectRef: toRef(ANSWERS, firstAnswer),
    op: 'insert',
    before: null,
    after: (await ownRow(env.jobs, 'application_answers', firstAnswer, env.userId, 'answer')) as Row,
    summary: `Dash added ${what} to the application for ${name}${also}.`,
    row: { table: ROLES, ref: roleId, title: name, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

/** The answer a call names: by its ref, or by its question on an application. */
async function namedAnswer(env: JobsWriteEnv, args: Args): Promise<Row> {
  const answerRef = text(args, 'answer_ref');
  if (answerRef) return ownRow(env.jobs, 'application_answers', idOf(answerRef, 'answer'), env.userId, 'answer');
  const question = text(args, 'question');
  if (!question) throw new JobsRefused('Name the answer: answer_ref, or question with application_ref or role_ref.');
  const application = await namedApplication(env, args);
  const { data, error } = await env.jobs
    .from('application_answers')
    .select('*')
    .eq('application_id', application.id as string)
    .eq('user_id', env.userId);
  if (error) throw new Error(`Reading the application's questions failed: ${error.message}`);
  const answers = (data ?? []) as Row[];
  const ids = answers.map((row) => row.question_id as string);
  const { data: bank, error: bankError } = ids.length
    ? await env.jobs.from('questions').select('id, text, fingerprint').in('id', ids).eq('user_id', env.userId)
    : { data: [], error: null };
  if (bankError) throw new Error(`Reading the questions failed: ${bankError.message}`);
  const questions = (bank ?? []) as Row[];
  const fingerprint = questionFingerprint(question);
  const needle = question.toLowerCase();
  let matches = questions.filter((row) => row.fingerprint === fingerprint);
  if (matches.length === 0) matches = questions.filter((row) => typeof row.text === 'string' && row.text.toLowerCase().includes(needle));
  if (matches.length !== 1) {
    const listing = questions.map((row) => `"${questionLine(row.text)}"`).join('; ');
    throw new JobsRefused(
      matches.length === 0
        ? `That application has no question like that.${listing ? ` It has: ${listing}.` : ' Add it with add_application_questions first.'}`
        : `More than one question on that application matches: ${matches.map((row) => `"${questionLine(row.text)}"`).join('; ')}. Give more of its words, or answer_ref.`,
    );
  }
  return answers.find((row) => row.question_id === matches[0].id)!;
}

async function ownEvidence(env: JobsWriteEnv, value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) throw new JobsRefused('evidence_refs must be a list of job_search.evidence_items refs.');
  const ids = [...new Set(value.map((ref) => idOf(typeof ref === 'string' ? ref.trim() : '', 'evidence item')))];
  if (ids.length > 40) throw new JobsRefused('Up to 40 evidence items on one answer.');
  if (ids.length === 0) return [];
  const { data, error } = await env.jobs.from('evidence_items').select('id').in('id', ids).eq('user_id', env.userId);
  if (error) throw new Error(`Reading the evidence failed: ${error.message}`);
  if ((data ?? []).length < ids.length) throw new JobsRefused('One of those is not an evidence item of theirs. Look them up first.');
  return ids;
}

async function saveAnswer(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await namedAnswer(env, args);
  const id = before.id as string;
  const update: AnswerEdit = {};

  if (given(args, 'answer')) {
    const answer = clearable(args, 'answer', ANSWER_MAX);
    if (answer === null) throw new JobsRefused('Give the answer\'s words. To leave a question unanswered, leave it as it is.');
    update.answer = answer;
  }
  const status = given(args, 'status') ? (oneOf(args, 'status', ANSWER_STATUSES, false) as (typeof ANSWER_STATUSES)[number]) : null;
  if (status) update.status = status;

  // A drafted answer keeps what it rests on, as the role page's Keep this draft does.
  let evidence: string[] = [];
  if (given(args, 'evidence_refs')) {
    evidence = await ownEvidence(env, args.evidence_refs);
    update.evidence_item_ids = evidence;
  }
  if (given(args, 'unsupported_claims')) {
    const claims = Array.isArray(args.unsupported_claims)
      ? args.unsupported_claims.map((claim) => (typeof claim === 'string' ? claim.trim() : '')).filter(Boolean)
      : null;
    if (!claims) throw new JobsRefused('unsupported_claims must be a list of the claims nothing on file backs.');
    if (claims.length > CLAIMS_MAX) throw new JobsRefused(`Up to ${CLAIMS_MAX} unsupported claims.`);
    update.unsupported_claims = claims;
  }
  if (given(args, 'considerations')) {
    // How to approach the question, re-read before submitting, as a kept draft has.
    const notes = Array.isArray(args.considerations)
      ? args.considerations.map((note) => (typeof note === 'string' ? note.trim() : '')).filter(Boolean)
      : null;
    if (!notes) throw new JobsRefused('considerations must be a list of short notes on how to approach the question.');
    if (notes.length > CONSIDERATIONS_MAX) throw new JobsRefused(`Up to ${CONSIDERATIONS_MAX} considerations.`);
    update.considerations = notes;
  }
  if (Object.keys(update).length === 0) {
    throw new JobsRefused('Nothing to change: give answer, status, evidence_refs, unsupported_claims or considerations.');
  }
  if (update.answer === undefined && (typeof before.answer !== 'string' || !before.answer.trim()) && status && status !== 'draft') {
    throw new JobsRefused('That question has no answer yet, so it cannot be approved or submitted. Give the answer too.');
  }

  // The same write as the role page's Save and Keep this draft.
  const { row: data, error } = await saveAnswerEdit(jobsDb(env), env.userId, id, update);
  if (error || !data) throw new Error(`Saving the answer failed: ${error ?? 'no row'}`);

  // Only the evidence newly cited counts as used again, so saving twice does not wear a story out.
  const added = evidence.filter((item) => !(Array.isArray(before.evidence_item_ids) && before.evidence_item_ids.includes(item)));
  await countEvidenceUse(jobsDb(env), added);

  const question = await ownRow(env.jobs, 'questions', before.question_id as string, env.userId, 'question');
  const application = await ownRow(env.jobs, 'applications', before.application_id as string, env.userId, 'application');
  const roleId = application.role_id as string;
  const role = await ownRow(env.jobs, 'roles', roleId, env.userId, 'role');
  const name = roleName(role, await companyName(env, role.company_id));
  const href = roleHref(roleId);
  const what = `the answer to "${questionLine(question.text)}"`;
  const [verb, rest] =
    update.answer !== undefined
      ? ['Saved', status && status !== 'draft' ? ` as ${status}, for ${name}` : ` for ${name}`]
      : status
        ? ['Marked', ` ${status}, for ${name}`]
        : ['Noted what backs', ` for ${name}`];
  return {
    kind: 'save_answer',
    input: { verb, what, rest, href, where: 'Open the role', paths: [...rolePaths(roleId), MATERIAL_HREF] },
    subjectRef: toRef(ANSWERS, id),
    op: 'update',
    before,
    after: data as Row,
    summary: `Dash ${verb.toLowerCase()} ${what}${rest}.`,
    row: { table: ANSWERS, ref: id, title: questionLine(question.text), href },
    undo: null,
  };
}

async function setDefaultAnswer(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  let question: Row;
  let fromAnswer: string | null = null;
  const questionRef = text(args, 'question_ref');
  const answerRef = text(args, 'answer_ref');
  if (questionRef) {
    question = await ownRow(env.jobs, 'questions', idOf(questionRef, 'question'), env.userId, 'question');
  } else if (answerRef) {
    const answer = await ownRow(env.jobs, 'application_answers', idOf(answerRef, 'answer'), env.userId, 'answer');
    question = await ownRow(env.jobs, 'questions', answer.question_id as string, env.userId, 'question');
    fromAnswer = typeof answer.answer === 'string' && answer.answer.trim() ? answer.answer.trim() : null;
  } else {
    throw new JobsRefused('Name the question: question_ref, or answer_ref for an answer to reuse.');
  }
  const answer = given(args, 'answer') ? clearable(args, 'answer', ANSWER_MAX) : fromAnswer;
  if (!answer) throw new JobsRefused(answerRef && !given(args, 'answer') ? 'That answer is empty, so there is nothing to reuse. Give the words in answer.' : 'Give the answer\'s words.');

  const id = question.id as string;
  const { row: data, error } = await setCanonicalAnswer(jobsDb(env), env.userId, id, answer);
  if (error || !data) throw new Error(`Setting the default answer failed: ${error ?? 'no row'}`);

  const line = `"${questionLine(question.text)}"`;
  return {
    kind: 'set_default_answer',
    input: { verb: 'Set', what: 'the answer reused for', rest: ` ${line}`, href: MATERIAL_HREF, where: 'Open the answer bank', paths: [MATERIAL_HREF] },
    subjectRef: toRef(QUESTIONS, id),
    op: 'update',
    before: question,
    after: data as Row,
    summary: `Dash set the answer reused for ${line} on every application.`,
    row: { table: QUESTIONS, ref: id, title: questionLine(question.text), href: MATERIAL_HREF },
    undo: null,
  };
}

function questionsUndo(value: Record<string, unknown> | null): QuestionsUndo | null {
  if (!value) return null;
  const answers = Array.isArray(value.answers) ? (value.answers as string[]) : [];
  const created = Array.isArray(value.created) ? (value.created as string[]) : [];
  const seen = Array.isArray(value.seen) ? (value.seen as QuestionsUndo['seen']) : [];
  const ok =
    answers.every(isUuid) &&
    created.every(isUuid) &&
    seen.every((row) => isUuid(row.id) && typeof row.before === 'number' && typeof row.after === 'number');
  return ok && answers.length > 0 ? { answers, created, seen } : null;
}

/**
 * Take a paste of questions back: the answer rows it added come off the
 * application, the counts it raised go back where they still hold what Dash
 * left, and the questions it added to the bank come out unless something has
 * been written on them or another application now holds them.
 */
async function putBackQuestions(deps: { userId: string; jobs: SchemaClient }, undo: QuestionsUndo): Promise<number> {
  let restored = 0;
  if (undo.answers.length > 0) {
    const { data, error } = await deps.jobs.from('application_answers').delete().in('id', undo.answers).eq('user_id', deps.userId).select('id');
    if (error) throw new Error(`${ANSWERS}: ${error.message}`);
    restored += (data ?? []).length;
  }
  for (const row of undo.seen) {
    const { data, error } = await deps.jobs
      .from('questions')
      .update({ times_seen: row.before })
      .eq('id', row.id)
      .eq('user_id', deps.userId)
      .eq('times_seen', row.after)
      .select('id');
    if (error) throw new Error(`${QUESTIONS}: ${error.message}`);
    restored += (data ?? []).length;
  }
  for (const id of undo.created) {
    const { data: held, error: heldError } = await deps.jobs.from('application_answers').select('id').eq('question_id', id).eq('user_id', deps.userId).limit(1);
    if (heldError) throw new Error(`${ANSWERS}: ${heldError.message}`);
    if ((held ?? []).length > 0) continue;
    const { data, error } = await deps.jobs.from('questions').delete().eq('id', id).eq('user_id', deps.userId).is('canonical_answer', null).select('id');
    if (error) throw new Error(`${QUESTIONS}: ${error.message}`);
    restored += (data ?? []).length;
  }
  return restored;
}

/**
 * Undo add_application_questions from what its record kept (QuestionsUndo).
 * Refused whole when an answer has been written into one of the questions
 * since, so the Undo never takes away words the person or Dash wrote later.
 * Ask's undo calls it for every surface (lib/ask/changes.ts, undoMany).
 */
export async function undoApplicationQuestions(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = questionsUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this change touched, so it cannot be undone.' };
  const jobs = await deps.db('job_search');
  const { data, error } = await jobs.from('application_answers').select('id, answer').in('id', undo.answers).eq('user_id', deps.userId);
  if (error) throw new Error(`${ANSWERS}: ${error.message}`);
  const answered = ((data ?? []) as Row[]).filter((row) => typeof row.answer === 'string' && row.answer.trim());
  if (answered.length > 0) {
    return { ok: false, error: 'One of those questions has been answered since, so undoing would lose the answer.' };
  }
  const restored = await putBackQuestions({ userId: deps.userId, jobs }, undo);
  if (restored === 0) return { ok: false, error: 'Those questions have already come off the application.' };
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// change_company
// ---------------------------------------------------------------------------

const COMPANIES = 'job_search.companies';
const PRIORITIES = ['target', 'interested', 'backup', 'passed'] as const;
const RESEARCH_MAX = 20_000;
const LINK_MAX = 2000;

const companyHref = (slug: string) => `/jobs/companies/${slug}`;

/** The company a call names: by its ref, or by its name as the company list matches one. */
async function namedCompany(env: JobsWriteEnv, args: Args): Promise<Row> {
  const ref = text(args, 'company_ref');
  if (ref) return ownRow(env.jobs, 'companies', idOf(ref, 'company'), env.userId, 'company');
  const name = text(args, 'company');
  if (!name) throw new JobsRefused('Name the company: company_ref, or company for its name.');
  const { data, error } = await env.jobs
    .from('companies')
    .select('*')
    .eq('user_id', env.userId)
    .eq('slug', slugify(name))
    .maybeSingle();
  if (error) throw new Error(`Reading the company failed: ${error.message}`);
  if (!data) throw new JobsRefused(`There is no company of theirs called ${name}. Look it up first.`);
  return data as Row;
}

/**
 * Domains as the company page saves them: they link mail to the company, so
 * "https://www.acme.com/jobs" is kept as "acme.com" and anything that is not
 * a domain is left out.
 */
function domainsOf(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : null;
  if (entries === null && value !== null) throw new JobsRefused('domains must be text or a list of domains, such as "acme.com".');
  return normalisedDomains((entries ?? []).filter((entry): entry is string => typeof entry === 'string'));
}

/** The fields change_company sets, by argument, with the column and the words for each. */
const COMPANY_FIELDS = [
  { arg: 'research', column: 'research', said: 'the research notes', max: RESEARCH_MAX },
  { arg: 'industry', column: 'industry', said: 'the industry', max: FIELD_MAX },
  { arg: 'hq_location', column: 'hq_location', said: 'the headquarters', max: FIELD_MAX },
  { arg: 'website', column: 'website', said: 'the website', max: LINK_MAX },
  { arg: 'careers_url', column: 'careers_url', said: 'the careers page', max: LINK_MAX },
  { arg: 'linkedin_url', column: 'linkedin_url', said: 'the LinkedIn page', max: LINK_MAX },
  // The Perspective tab's six answers, by their column names.
  ...PERSPECTIVE_QUESTIONS.map((question) => ({
    arg: question.column,
    column: question.column,
    said: `the perspective's "${question.label}"`,
    max: RESEARCH_MAX,
  })),
] as const;

async function changeCompany(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await namedCompany(env, args);
  if (given(args, 'note')) return noteOnCompany(env, args, before);
  const id = before.id as string;
  const update: Row = {};
  const changed: string[] = [];

  if (given(args, 'name')) {
    // As the page renames one: the slug is its address and what the inbox
    // matches it by, so it moves with the name, and a name another company
    // already has is refused.
    const name = text(args, 'name');
    if (!name) throw new JobsRefused('A company needs a name: give the new one, or leave name out.');
    if (name.length > COMPANY_NAME_MAX) throw new JobsRefused(`Keep the name under ${COMPANY_NAME_MAX} characters.`);
    const rename = await renameUpdate(env.jobs as unknown as AppSupabaseClient, env.userId, id, name);
    if (rename.error !== null) throw new JobsRefused(rename.error.replace(/^You already have/, 'They already have'));
    if (name !== before.name) {
      Object.assign(update, rename.update);
      changed.push(`the name, to ${name}`);
    }
  }
  if (given(args, 'priority')) {
    update.priority = oneOf(args, 'priority', PRIORITIES, false);
    changed.push(`the priority, to ${update.priority as string}`);
  }
  for (const field of COMPANY_FIELDS) {
    if (!given(args, field.arg)) continue;
    update[field.column] = clearable(args, field.arg, field.max);
    changed.push(field.said);
    if (field.column.startsWith('perspective_')) update.perspective_updated_at = new Date().toISOString();
  }
  if (given(args, 'domains')) {
    update.domains = domainsOf(args.domains);
    changed.push('the domains');
  }

  if (Object.keys(update).length === 0) throw new JobsRefused('Nothing to change: give at least one field with its new value.');

  // The same write as the company page's fields and its rename.
  const { row: data, error } = await saveCompanyEdit(env.jobs as unknown as AppSupabaseClient, env.userId, id, update);
  if (error?.code === '23505') throw new JobsRefused('They already have a company by that name.');
  if (error || !data) throw new Error(`Changing the company failed: ${error?.message ?? 'no row'}`);

  const after = data as Row;
  const was = before.name as string;
  const now = after.name as string;
  const href = companyHref(after.slug as string);
  return {
    kind: 'change_company',
    input: {
      verb: 'Changed',
      what: now,
      rest: `: ${listed(changed)}`,
      href,
      where: 'Open the company',
      paths: ['/jobs', '/jobs/companies', '/jobs/pipeline', '/jobs/roles', href, companyHref(before.slug as string)],
    },
    subjectRef: toRef(COMPANIES, id),
    op: 'update',
    before,
    after,
    summary: `Dash changed ${listed(changed)} on the company ${was}.`,
    row: { table: COMPANIES, ref: id, title: now, href },
    undo: null,
  };
}

/**
 * A note on the company, as the company page's Add note files it
 * (fileJobNote, plan #2473.8). It is its own change, so its Undo takes the
 * note out and leaves the company as it was.
 */
async function noteOnCompany(env: JobsWriteEnv, args: Args, company: Row): Promise<JobsMade> {
  const others = Object.keys(args).filter((key) => !['company_ref', 'company', 'note'].includes(key) && given(args, key));
  if (others.length) throw new JobsRefused('Add the note on its own: make the other changes in a second call.');
  const body = text(args, 'note');
  if (!body) throw new JobsRefused('note is empty: write the note.');
  if (body.length > NOTES_MAX) throw new JobsRefused(`Keep the note under ${NOTES_MAX} characters.`);

  const id = company.id as string;
  const filed = await fileJobNote(env.jobs as unknown as AppSupabaseClient, env.userId, { companyId: id, body });
  if (filed.error !== null) throw new Error(`Adding the company note failed: ${filed.error}`);

  const name = company.name as string;
  const href = companyHref(company.slug as string);
  return {
    kind: 'change_company',
    input: {
      verb: 'Added a note to',
      what: name,
      rest: `: "${body.length > 80 ? `${body.slice(0, 79)}…` : body}"`,
      href,
      where: 'Open the company',
      paths: ['/jobs/companies', href],
    },
    subjectRef: toRef('job_search.notes', filed.row.id as string),
    op: 'insert',
    before: null,
    after: filed.row,
    summary: `Dash added a note to the company ${name}.`,
    row: { table: COMPANIES, ref: id, title: name, href },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// add_company
// ---------------------------------------------------------------------------

/** What add_company keeps in `undo`: the company it made. */
export type AddedCompanyUndo = { company_id: string };

/**
 * A company added from scratch, as the companies page's Add company does: by
 * name, matched against theirs first so a company already on file is named
 * back rather than made twice, then given the priority and details the call
 * names. Its Undo takes the company out again while nothing hangs on it.
 */
async function addCompany(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const name = text(args, 'name');
  if (!name) throw new JobsRefused('Name the company to add.');
  if (name.length > COMPANY_NAME_MAX) throw new JobsRefused(`Keep the name under ${COMPANY_NAME_MAX} characters.`);

  // Every field is checked before anything is written.
  const update: Row = {};
  const said: string[] = [];
  if (given(args, 'priority')) update.priority = oneOf(args, 'priority', PRIORITIES, false);
  for (const field of COMPANY_FIELDS) {
    if (field.column.startsWith('perspective_') || !given(args, field.arg)) continue;
    const value = clearable(args, field.arg, field.max);
    if (value === null) continue;
    update[field.column] = value;
    said.push(field.said);
  }
  const domains = given(args, 'domains') ? domainsOf(args.domains) : [];

  const company = await ensureCompany(env.jobs as unknown as AppSupabaseClient, env.userId, name, {
    website: (update.website as string | undefined) ?? null,
    careersUrl: (update.careers_url as string | undefined) ?? null,
  });
  if (company.error) throw new Error(`Adding the company failed: ${company.error}`);
  if (!company.created) {
    const held = await ownRow(env.jobs, 'companies', company.id, env.userId, 'company');
    throw new JobsRefused(
      `They already have ${held.name as string} on file (${toRef(COMPANIES, company.id)}). Change it with change_company instead.`,
    );
  }

  if (domains.length > 0) {
    const { data: made } = await env.jobs.from('companies').select('domains').eq('id', company.id).eq('user_id', env.userId).maybeSingle();
    update.domains = [...new Set([...(((made as Row | null)?.domains as string[] | null) ?? []), ...domains])];
    said.push('the domains');
  }
  let after: Row;
  if (Object.keys(update).length > 0) {
    const { data, error } = await env.jobs.from('companies').update(update).eq('id', company.id).eq('user_id', env.userId).select('*').single();
    if (error || !data) {
      await env.jobs.from('companies').delete().eq('id', company.id).eq('user_id', env.userId);
      throw new Error(`Setting the company's details failed: ${error?.message ?? 'no row'}`);
    }
    after = data as Row;
  } else {
    after = await ownRow(env.jobs, 'companies', company.id, env.userId, 'company');
  }

  const now = after.name as string;
  const priority = after.priority as string;
  const href = companyHref(after.slug as string);
  const undo: AddedCompanyUndo = { company_id: company.id };
  return {
    kind: 'add_company',
    input: {
      verb: 'Added',
      what: now,
      rest: ` to your companies as ${priority}`,
      href,
      where: 'Open the company',
      paths: ['/jobs', '/jobs/companies', href],
    },
    subjectRef: toRef(COMPANIES, company.id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash added ${now} to the companies as ${priority}${said.length > 0 ? `, with ${listed(said)}` : ''}.`,
    row: { table: COMPANIES, ref: company.id, title: now, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

/**
 * Undo a company added from scratch (AddedCompanyUndo): it is taken out while
 * nothing hangs on it, and stays once a role, contact or note has been filed
 * under it. Ask's undo calls it for every surface (lib/ask/changes.ts, undoMany).
 */
export async function undoAddedCompany(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const companyId = recorded?.company_id;
  if (typeof companyId !== 'string' || !isUuid(companyId)) {
    return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  }
  if (await companyHeld(deps, companyId)) {
    return { ok: false, error: 'Something has been filed under this company since, so it stays. Take it out on its page.' };
  }
  const jobs = await deps.db('job_search');
  const { data, error } = await jobs.from('companies').delete().eq('id', companyId).eq('user_id', deps.userId).select('id');
  if (error) throw new Error(`companies: ${error.message}`);
  if ((data ?? []).length === 0) return { ok: false, error: 'The company has gone already.' };
  return { ok: true, restored: 1 };
}

// ---------------------------------------------------------------------------
// merge_roles
// ---------------------------------------------------------------------------

/**
 * The rows that hang off an application, by `schema.table`, with the column
 * that names it, whether the table keeps a user_id, and the columns that,
 * with the application, may hold only one row. job_search.merge_roles moves
 * every one onto the application kept, reading the keys itself; these lists
 * are what Dash's merge reads before and after it, to record each row's move
 * for its Undo, and what the in-memory database in
 * tests/stubs/fake-schema-db.ts moves. A table added with a foreign key to
 * applications or roles and left out of these lists fails
 * tests/merge-children-jobs.test.ts, which reads the keys from the database.
 */
export const APPLICATION_CHILDREN = [
  { table: 'job_search.application_drafts', column: 'application_id', owned: true, unique: 'kind' },
  { table: 'job_search.application_events', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.application_answers', column: 'application_id', owned: true, unique: 'question_id' },
  { table: 'job_search.application_outreach', column: 'application_id', owned: true, unique: 'contact_id' },
  { table: 'job_search.attachments', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.contact_touches', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.cover_letters', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.interviews', column: 'application_id', owned: true, unique: 'ics_uid' },
  { table: 'job_search.interview_groups', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.message_link_dismissals', column: 'application_id', owned: true, unique: 'message_id' },
  { table: 'job_search.notes', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.reminders', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.quiet_dismissals', column: 'application_id', owned: true, unique: 'user_id' },
  { table: 'job_search.ingested_messages', column: 'resulting_application_id', owned: false, unique: null },
  { table: 'todo.task_links', column: 'application_id', owned: false, unique: null },
] as const;

/**
 * The rows that hang off a role itself, moved onto the role kept. Its
 * applications are handled on their own, and a role's old thread notes
 * (job_search.notes.role_id) refuse the merge (refuseThreads). A merged
 * role's fact origin moves too, unless the role kept has one for that field.
 */
export const ROLE_CHILDREN = [
  { table: 'job_search.attachments', column: 'role_id', owned: true, unique: null },
  { table: 'job_search.fact_origins', column: 'role_id', owned: true, unique: 'field' },
  { table: 'job_search.suggestions', column: 'role_id', owned: true, unique: null },
  { table: 'todo.task_links', column: 'role_id', owned: false, unique: null },
] as const;

/** Every table a merge's undo may name, and whether it keeps a user_id. */
const MERGE_TABLES: Record<string, boolean> = {
  [ROLES]: true,
  [APPLICATIONS]: true,
  ...Object.fromEntries(APPLICATION_CHILDREN.map((child) => [child.table, child.owned])),
  ...Object.fromEntries(ROLE_CHILDREN.map((child) => [child.table, child.owned])),
};

const MERGE_MAX = 10;

/**
 * What a merge keeps in `undo`, in the order its Undo puts it back: the
 * roles it took out, whole; the rows it updated in place (the application
 * kept, moved onto the role kept), with the columns before and after; the
 * applications it took out, whole; the rows it moved from one application or
 * role to another; and the rows it took out because the application kept
 * already had their twin (an answer to the same question), whole.
 */
export type MergeUndo = {
  roles_removed: Row[];
  updated: { table: string; id: string; before: Row; after: Row }[];
  applications_removed: Row[];
  moved: { table: string; id: string; column: string; from: string; to: string }[];
  removed: { table: string; values: Row }[];
};

function schemaOf(env: JobsWriteEnv, table: string): { client: SchemaClient; name: string } {
  const [schema, name] = table.split('.');
  return { client: schema === 'todo' ? env.todo : env.jobs, name };
}

async function rowsWhere(env: JobsWriteEnv, table: string, column: string, values: string[], owned: boolean): Promise<Row[]> {
  if (values.length === 0) return [];
  const { client, name } = schemaOf(env, table);
  let query = client.from(name).select('*').in(column, values);
  if (owned) query = query.eq('user_id', env.userId);
  const { data, error } = await query;
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return (data ?? []) as Row[];
}

/**
 * A role's thread is not among the rows the Undo reads and puts back, so
 * Dash refuses a role with comments; the company page's button moves them.
 */
async function refuseThreads(env: JobsWriteEnv, merged: Row[], losers: string[], names: Map<string, string>): Promise<void> {
  for (const role of merged) {
    const { data, error } = await env.core
      .from('thread_turns')
      .select('id')
      .eq('user_id', env.userId)
      .eq('ref', toRef(ROLES, role.id as string))
      .limit(1);
    if (error) throw new Error(`Reading the role's thread failed: ${error.message}`);
    if ((data ?? []).length > 0) {
      throw new JobsRefused(
        `${names.get(role.id as string)} has comments in its thread, which Dash's merge cannot undo. Ask them to merge on the company page, which carries the comments over.`,
      );
    }
  }
  // The role notes kept from before threads moved to core are read-only now,
  // so they can be neither moved nor put back.
  const legacy = [
    ...(await rowsWhere(env, 'job_search.notes', 'role_id', merged.map((role) => role.id as string), true)),
    ...(await rowsWhere(env, 'job_search.notes', 'application_id', losers, true)).filter((note) => note.role_id !== null),
  ];
  if (legacy.length > 0) {
    throw new JobsRefused('One of those roles has comments from its old thread, which a merge cannot move. Ask them to merge on the company page.');
  }
}

async function mergeRoles(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const keepId = idOf(text(args, 'keep_role_ref'), 'role');
  const raw = args.merge_role_refs;
  if (!Array.isArray(raw) || raw.length === 0) throw new JobsRefused('merge_role_refs lists the duplicate roles to fold in, by their refs.');
  if (raw.length > MERGE_MAX) throw new JobsRefused(`Merge at most ${MERGE_MAX} roles at a time.`);
  const mergedIds = [...new Set(raw.map((ref) => idOf(typeof ref === 'string' ? ref.trim() : '', 'role')))];
  if (mergedIds.includes(keepId)) throw new JobsRefused('The role to keep is among those to merge in. Pick a different role to keep.');

  const kept = await ownRow(env.jobs, 'roles', keepId, env.userId, 'role');
  const merged: Row[] = [];
  for (const id of mergedIds) merged.push(await ownRow(env.jobs, 'roles', id, env.userId, 'role'));
  if (merged.some((role) => role.company_id !== kept.company_id)) {
    throw new JobsRefused('Roles can only be merged within the same company.');
  }

  const company = await companyName(env, kept.company_id);
  const names = new Map([kept, ...merged].map((role) => [role.id as string, roleName(role, company)]));

  const roleIds = [keepId, ...mergedIds];
  const apps = await rowsWhere(env, APPLICATIONS, 'role_id', roleIds, true);
  const target: Row | null = keptApplication(apps as (Row & MergeApplication)[]);
  const losers = apps.filter((app) => app.id !== target?.id);
  const loserIds = losers.map((app) => app.id as string);

  await refuseThreads(env, merged, loserIds, names);

  // What the merge will move: every row on a duplicate application or role,
  // read whole before the function runs, so the Undo can put back the ones
  // it takes out.
  const beforeRows = async (children: readonly { table: string; column: string; owned: boolean }[], parents: string[]) =>
    Promise.all(children.map(async (child) => ({ child, rows: await rowsWhere(env, child.table, child.column, parents, child.owned) })));
  const beforeApps = target ? await beforeRows(APPLICATION_CHILDREN, loserIds) : [];
  const beforeRoles = await beforeRows(ROLE_CHILDREN, mergedIds);

  // The same merge as the company page's Merge roles button, in one transaction.
  const { keptApplicationId, error: mergeError } = await mergeRolesInto(env.jobs, keepId, mergedIds, apps as MergeApplication[]);
  if (mergeError) {
    // The function's own refusals say why in words; anything else is a failure.
    if (mergeError.code === '22023' || mergeError.code === 'P0002') throw new JobsRefused(mergeError.message);
    throw new Error(`The merge failed: ${mergeError.message}`);
  }
  if (keptApplicationId !== (target?.id ?? null)) throw new Error('The merge kept a different application from the one read.');

  // Then what it did, read back: each row is now on the one kept, or gone
  // because the one kept already had its twin.
  const undo: MergeUndo = { roles_removed: [], updated: [], applications_removed: [], moved: [], removed: [] };
  try {
    for (const { child, rows } of [...beforeApps, ...beforeRoles]) {
      if (rows.length === 0) continue;
      const now = new Map((await rowsWhere(env, child.table, 'id', rows.map((row) => row.id as string), child.owned)).map((row) => [row.id as string, row]));
      for (const row of rows) {
        const moved = now.get(row.id as string);
        if (!moved) undo.removed.push({ table: child.table, values: row });
        else if (moved[child.column] !== row[child.column]) {
          undo.moved.push({ table: child.table, id: row.id as string, column: child.column, from: row[child.column] as string, to: moved[child.column] as string });
        }
      }
    }
    if (target) {
      const targetId = target.id as string;
      const [now] = await rowsWhere(env, APPLICATIONS, 'id', [targetId], true);
      if (now) {
        const changed = ['role_id', 'attempt', 'status_manual_override'].filter((column) => (now[column] ?? null) !== (target[column] ?? null));
        if (changed.length > 0) {
          undo.updated.push({
            table: APPLICATIONS,
            id: targetId,
            before: Object.fromEntries(changed.map((column) => [column, target[column] ?? null])),
            after: Object.fromEntries(changed.map((column) => [column, now[column] ?? null])),
          });
        }
      }
      const left = new Set((await rowsWhere(env, APPLICATIONS, 'id', loserIds, true)).map((app) => app.id as string));
      undo.applications_removed.push(...losers.filter((app) => !left.has(app.id as string)));
    }
    const left = new Set((await rowsWhere(env, ROLES, 'id', mergedIds, true)).map((role) => role.id as string));
    undo.roles_removed.push(...merged.filter((role) => !left.has(role.id as string)));
  } catch (error) {
    throw new Error(`The roles were merged, but reading back what moved failed, so the merge has no Undo: ${(error as Error).message}`);
  }

  const after = await ownRow(env.jobs, 'roles', keepId, env.userId, 'role');
  const keptName = names.get(keepId) as string;
  const folded = listed(mergedIds.map((id) => `"${names.get(id)}"`));
  const href = roleHref(keepId);
  return {
    kind: 'merge_roles',
    input: {
      verb: 'Merged',
      what: keptName,
      rest: `: folded in ${folded}`,
      href,
      where: 'Open the role',
      paths: [...rolePaths(keepId), '/jobs/analytics'],
    },
    subjectRef: toRef(ROLES, keepId),
    op: 'update',
    before: kept,
    after,
    summary: `Dash merged ${folded} into the role ${keptName}.`,
    row: { table: ROLES, ref: keepId, title: keptName, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

function mergeUndo(value: Record<string, unknown> | null): MergeUndo | null {
  if (!value) return null;
  const list = (key: string) => (Array.isArray(value[key]) ? (value[key] as Row[]) : []);
  const known = (table: unknown) => typeof table === 'string' && table in MERGE_TABLES;
  const undo: MergeUndo = {
    roles_removed: list('roles_removed'),
    updated: list('updated') as MergeUndo['updated'],
    applications_removed: list('applications_removed'),
    moved: list('moved') as MergeUndo['moved'],
    removed: list('removed') as MergeUndo['removed'],
  };
  const ok =
    [...undo.roles_removed, ...undo.applications_removed].every((row) => typeof row.id === 'string') &&
    undo.updated.every((row) => known(row.table) && typeof row.id === 'string' && row.before && row.after) &&
    undo.moved.every((row) => known(row.table) && typeof row.id === 'string' && typeof row.column === 'string') &&
    undo.removed.every((row) => known(row.table) && row.values && typeof row.values === 'object');
  const count = undo.roles_removed.length + undo.updated.length + undo.applications_removed.length + undo.moved.length + undo.removed.length;
  return ok && count > 0 ? undo : null;
}

const scalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** The undo a merge kept, put back in order; how many rows went back. */
async function putBackMerge(deps: { userId: string; db: AskDb }, undo: MergeUndo): Promise<number> {
  const client = async (table: string) => {
    const [schema, name] = table.split('.');
    return { db: await deps.db(schema as AskSchema), name, owned: MERGE_TABLES[table] ?? false };
  };
  let restored = 0;
  const reinsert = async (table: string, values: Row) => {
    const { db, name, owned } = await client(table);
    if (owned && values.user_id !== deps.userId) return;
    const { data, error } = await db.from(name).upsert(values, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`${table}: ${error.message}`);
    restored += (data ?? []).length;
  };

  // The roles first, so the applications and rows moved off them have somewhere to go back to.
  for (const role of undo.roles_removed) await reinsert(ROLES, role);
  // The application kept goes back to its own role and attempt before the
  // duplicates come back, since one of them may have held that attempt.
  for (const row of undo.updated) {
    const { db, name, owned } = await client(row.table);
    let query = db.from(name).update(row.before).eq('id', row.id);
    if (owned) query = query.eq('user_id', deps.userId);
    for (const [column, value] of Object.entries(row.after)) {
      if (!scalar(value)) continue;
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  for (const app of undo.applications_removed) await reinsert(APPLICATIONS, app);
  for (const row of undo.moved) {
    const { db, name } = await client(row.table);
    // Only a row still where the merge left it goes back; one moved again since stays.
    const { data, error } = await db.from(name).update({ [row.column]: row.from }).eq('id', row.id).eq(row.column, row.to).select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  for (const row of undo.removed) await reinsert(row.table, row.values);
  return restored;
}

/**
 * Undo a merge of roles from what its record kept (MergeUndo): the roles and
 * applications taken out come back with their own ids, and every row moved
 * goes back where it was, unless it has moved again since. Ask's undo calls
 * it for every surface (lib/ask/changes.ts, undoMany).
 */
export async function undoRoleMerge(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = mergeUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this merge changed, so it cannot be undone.' };
  const restored = await putBackMerge(deps, undo);
  if (restored === 0) {
    return { ok: false, error: 'Everything this merge changed has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// change_reminder
// ---------------------------------------------------------------------------

const REMINDERS = 'job_search.reminders';
const WAITING = 'job_search.waiting_dismissals';
const BODY_MAX = 1000;

/**
 * The day a put-off ends, from the one Later menu's choices as Jobs Today's
 * Later offers them (plan #1957.9), read in their zone.
 */
function putOffUntil(env: JobsWriteEnv, choice: unknown, field: string): { at: string; words: string } {
  const zone = env.timezone ?? 'UTC';
  const later = typeof choice === 'string' ? laterUntil(choice, zone) : null;
  if (!later) throw new JobsRefused(`${field} must be ${LATER_UNTIL_HELP}.`);
  return { at: later.until.toISOString(), words: untilWords(later.day, zone) };
}

/** The role an application is on, for the words a change is told in. */
async function applicationRole(env: JobsWriteEnv, applicationId: unknown): Promise<{ id: string; name: string } | null> {
  if (typeof applicationId !== 'string') return null;
  const { data: application } = await env.jobs
    .from('applications')
    .select('role_id')
    .eq('id', applicationId)
    .eq('user_id', env.userId)
    .maybeSingle();
  const roleId = (application as Row | null)?.role_id;
  if (typeof roleId !== 'string') return null;
  const { data: role } = await env.jobs.from('roles').select('*').eq('id', roleId).eq('user_id', env.userId).maybeSingle();
  if (!role) return null;
  return { id: roleId, name: roleName(role as Row, await companyName(env, (role as Row).company_id)) };
}

/** "Send the take-home", as the reminder reads, cut for a sentence. */
function quotedBody(body: unknown, fallback: string): string {
  const said = typeof body === 'string' && body.trim() ? body.trim() : fallback;
  return `"${said.length > 100 ? `${said.slice(0, 99).trimEnd()}…` : said}"`;
}

/** A day, as the timeline's date field sends one and reads it back (midnight UTC), or a moment. */
function dueOf(args: Args): string {
  const value = text(args, 'due');
  const at = new Date(value);
  if (!value || Number.isNaN(at.getTime())) throw new JobsRefused('due must be a day, YYYY-MM-DD, or a date and time.');
  return at.toISOString();
}

/**
 * The email a call names: the job_search.inbox_messages ref, or the ref
 * search_mail returned (`<mailbox>:<message id>`), read by the person's user
 * id either way, as the timeline's picker checks it.
 */
async function namedEmail(env: JobsWriteEnv, ref: string): Promise<Row> {
  let query = env.jobs.from('inbox_messages').select('id, subject, classification, received_at').eq('user_id', env.userId);
  if (isUuid(ref)) query = query.eq('id', ref);
  else {
    const at = ref.indexOf(':');
    if (at <= 0 || !isUuid(ref.slice(0, at))) throw new JobsRefused('email_ref must be the ref search_mail or a lookup returned for the email.');
    query = query.eq('email_account_id', ref.slice(0, at)).eq('provider_message_id', ref.slice(at + 1));
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Reading the email failed: ${error.message}`);
  if (!data) throw new JobsRefused('That email is not one the job search has read. Only mail it has taken in can be linked.');
  return data as Row;
}

async function changeReminder(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await ownRow(env.jobs, 'reminders', idOf(text(args, 'reminder_ref'), 'reminder'), env.userId, 'reminder');
  const id = before.id as string;
  const update: ReminderEdit = {};
  const changed: string[] = [];

  if (args.finish === true && given(args, 'put_off')) throw new JobsRefused('Finish it or put it off, not both.');
  if (args.finish === true) {
    if (before.completed_at) throw new JobsRefused('That reminder is finished already.');
    update.completed_at = new Date().toISOString();
    changed.push('finished');
  }
  if (given(args, 'put_off')) {
    if (given(args, 'due')) throw new JobsRefused('Put it off, or give it a new due date, not both.');
    const until = putOffUntil(env, args.put_off, 'put_off');
    update.due_at = until.at;
    changed.push(`put off ${until.words}`);
  }
  if (given(args, 'body')) {
    const body = text(args, 'body');
    if (!body) throw new JobsRefused('A reminder needs words: say what it is, or leave body out.');
    if (body.length > BODY_MAX) throw new JobsRefused(`Keep it under ${BODY_MAX} characters.`);
    if (body !== before.body) {
      update.body = body;
      changed.push(`reworded to ${quotedBody(body, '')}`);
    }
  }
  if (given(args, 'due')) {
    update.due_at = dueOf(args);
    changed.push('moved to a new due date');
  }
  if (given(args, 'email_ref')) {
    const ref = typeof args.email_ref === 'string' ? args.email_ref.trim() : '';
    if (!ref) {
      if (before.ingested_message_id === null) throw new JobsRefused('That reminder has no email linked to it.');
      update.ingested_message_id = null;
      changed.push('unlinked from its email');
    } else {
      const email = await namedEmail(env, ref);
      update.ingested_message_id = email.id as string;
      changed.push(`linked to the email ${quotedBody(email.subject, 'with no subject')}`);
    }
  }

  if (Object.keys(update).length === 0) {
    throw new JobsRefused('Nothing to change: give finish, put_off, body, due or email_ref.');
  }

  // The same write as Jobs Today's Done and Later and the timeline's edit and link.
  const { row: after, error } = await saveReminderEdit(jobsDb(env), env.userId, id, update);
  if (error || !after) throw new Error(`Changing the reminder failed: ${error ?? 'no row'}`);

  const role = await applicationRole(env, before.application_id);
  const was = quotedBody(before.body, 'reminder');
  const said = listed(changed);
  const href = role ? roleHref(role.id) : '/jobs';
  return {
    kind: 'change_reminder',
    input: {
      verb: 'Changed',
      what: was,
      rest: role ? ` on ${role.name}: ${said}` : `: ${said}`,
      href,
      where: role ? 'Open the role' : 'Open Jobs',
      paths: [...(role ? rolePaths(role.id) : ['/jobs']), '/todo'],
    },
    subjectRef: toRef(REMINDERS, id),
    op: 'update',
    before,
    after,
    summary: `Dash ${said} the reminder ${was}${role ? ` on ${role.name}` : ''}.`,
    row: { table: REMINDERS, ref: id, title: quotedBody(after.body, 'reminder'), href },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// change_waiting
// ---------------------------------------------------------------------------

/**
 * Jobs Today's "Waiting on you" rows are mail that asked something of them,
 * recomputed from the event log on every load, so finishing one or putting
 * it off writes a row of its own in job_search.waiting_dismissals, as the
 * page does: no date for done, the day chosen for later. The first time that row
 * is new, and its Undo takes it out; after that it is changed in place.
 */
async function changeWaiting(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const verb = text(args, 'verb');
  if (verb !== 'finish' && verb !== 'put_off') throw new JobsRefused('verb must be finish or put_off.');
  const event = await ownRow(env.jobs, 'application_events', idOf(text(args, 'event_ref'), 'event'), env.userId, 'event');
  const payload = (event.payload ?? {}) as Row;
  if (payload.action_required !== true && payload.action_required !== 'true') {
    throw new JobsRefused('That event is not one waiting on them: only mail that asked them something is on "Waiting on you".');
  }
  const eventId = event.id as string;

  const { data: existing, error: readError } = await env.jobs
    .from('waiting_dismissals')
    .select('*')
    .eq('user_id', env.userId)
    .eq('application_event_id', eventId)
    .maybeSingle();
  if (readError) throw new Error(`Reading the waiting row failed: ${readError.message}`);
  const before = (existing as Row | null) ?? null;
  if (verb === 'finish' && before && before.dismissed_until === null) throw new JobsRefused('That one is marked done already.');

  const later = verb === 'finish' ? null : putOffUntil(env, args.until, 'until');
  const until = later?.at ?? null;
  // The same write as Jobs Today's Done and Later on the row.
  const { error } = await setWaitingDismissal(jobsDb(env), env.userId, eventId, until);
  if (error) throw new Error(`Changing the waiting row failed: ${error}`);
  const { data, error: afterError } = await env.jobs
    .from('waiting_dismissals')
    .select('*')
    .eq('user_id', env.userId)
    .eq('application_event_id', eventId)
    .maybeSingle();
  if (afterError || !data) throw new Error(`Reading the waiting row failed: ${afterError?.message ?? 'no row'}`);

  const after = data as Row;
  const role = await applicationRole(env, event.application_id);
  const what = quotedBody(event.summary, 'the email that asked them something');
  const said = later ? `put off ${later.words}` : 'marked done';
  const href = role ? roleHref(role.id) : '/jobs';
  return {
    kind: 'change_waiting',
    input: {
      verb: verb === 'finish' ? 'Done' : 'Put off',
      what,
      rest: role ? ` on ${role.name}, waiting on you` : ', waiting on you',
      href: '/jobs',
      where: 'Open Jobs',
      paths: ['/jobs', ...(role ? [roleHref(role.id)] : [])],
    },
    subjectRef: toRef(WAITING, after.id as string),
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: `Dash ${said} ${what}${role ? ` on ${role.name}` : ''}, from "Waiting on you" on Jobs Today.`,
    row: { table: 'job_search.application_events', ref: eventId, title: what, href },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// change_role_email
// ---------------------------------------------------------------------------

const MESSAGES = 'job_search.ingested_messages';

/** The columns of an ingested message that linking and unlinking write. */
const LINK_COLUMNS = ['resulting_application_id', 'parse_status', 'link_method', 'link_confidence', 'error'] as const;

/**
 * What a link, a turned-down suggestion or an unlink keeps in `undo`: the
 * message's link columns before and after, the events it took out whole or
 * put in, the "not this one" mark it added, and the round it booked. The
 * Undo (undoRoleEmail) puts each back where the row still holds what Dash
 * left. The message has no user_id of its own, so the person's ownership is
 * read through job_search.inbox_messages, which carries it.
 */
export type RoleEmailUndo = {
  message_id: string;
  message_before: Row | null;
  message_after: Row | null;
  events_removed: Row[];
  events_added: string[];
  dismissal_added: string | null;
  interview_added: { interview_id: string; group_id: string | null } | null;
};

const pickLink = (row: Row): Row => Object.fromEntries(LINK_COLUMNS.map((column) => [column, row[column] ?? null]));

async function changeRoleEmail(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const action = text(args, 'action');
  if (action !== 'link' && action !== 'decline' && action !== 'unlink') throw new JobsRefused('action must be link, decline or unlink.');
  const application = await namedApplication(env, args);
  const applicationId = application.id as string;
  const emailRef = text(args, 'email_ref');
  if (!emailRef) throw new JobsRefused('Name the email: email_ref, the ref search_mail or a lookup returned.');
  // Through the inbox view, which carries the person's user id.
  const email = await namedEmail(env, emailRef);
  const messageId = email.id as string;
  const { data: stored, error: storedError } = await env.jobs.from('ingested_messages').select('*').eq('id', messageId).maybeSingle();
  if (storedError) throw new Error(`Reading the email failed: ${storedError.message}`);
  if (!stored) throw new JobsRefused('That email is no longer in the mailbox.');
  const message = stored as Row;

  const undo: RoleEmailUndo = {
    message_id: messageId,
    message_before: null,
    message_after: null,
    events_removed: [],
    events_added: [],
    dismissal_added: null,
    interview_added: null,
  };
  const subject = quotedBody(email.subject, 'an email with no subject');
  const role = await applicationRole(env, applicationId);
  const onRole = role ? ` on ${role.name}` : '';
  const backOut = (error: unknown, failed: string) =>
    putBackRoleEmail({ userId: env.userId, db: async () => env.jobs }, undo).then(
      () => {
        throw error;
      },
      (putBack: unknown) => {
        console.error(`change_role_email: putting a failed ${failed} back failed`, putBack);
        throw error;
      },
    );

  // The same writes as the role page's mail tab and the review queue's link (lib/jobs/inbox/role-mail.ts).
  const markDeclined = async () => {
    const { id, error } = await declineMessageForApplication(jobsDb(env), env.userId, applicationId, messageId);
    if (error || !id) throw new Error(`Remembering the decline failed: ${error ?? 'no row'}`);
    return id;
  };

  let summary: string;
  let verb: string;
  let rest: string;
  if (action === 'decline') {
    if (message.resulting_application_id === applicationId) throw new JobsRefused('That email is linked to this role already. Unlink it instead.');
    const { data: marked } = await env.jobs
      .from('message_link_dismissals')
      .select('id')
      .eq('user_id', env.userId)
      .eq('application_id', applicationId)
      .eq('message_id', messageId)
      .maybeSingle();
    if (marked) throw new JobsRefused('That email has been turned down for this role already.');
    undo.dismissal_added = await markDeclined();
    summary = `Dash turned down ${subject} as a match${onRole}.`;
    verb = 'Turned down';
    rest = `${onRole}, so it is not suggested again`;
  } else if (action === 'link') {
    if (message.resulting_application_id === applicationId) throw new JobsRefused('That email is linked to this role already.');
    if (message.resulting_application_id) {
      throw new JobsRefused('That email is linked to another role. Unlink it from there first, then link it here.');
    }
    undo.message_before = pickLink(message);
    const linked = await linkMessageToApplication(jobsDb(env), env.userId, {
      id: messageId,
      classification: email.classification,
      received_at: email.received_at,
      subject: email.subject,
    }, { id: applicationId, status: application.status });
    if (!linked.linked) throw new Error(`Linking the email failed: ${linked.error}`);
    undo.message_after = { resulting_application_id: applicationId, ...LINKED_BY_HAND };
    if (linked.eventId) undo.events_added.push(linked.eventId);
    if (linked.round) undo.interview_added = { interview_id: linked.round.interviewId, group_id: linked.round.groupCreated ? linked.round.groupId : null };
    if (linked.error) return backOut(new Error(linked.error), 'link');
    summary = `Dash linked ${subject} to the role${onRole}.`;
    verb = 'Linked';
    rest = onRole;
  } else {
    if (message.resulting_application_id !== applicationId) throw new JobsRefused('That email is not linked to this role, so there is nothing to unlink.');
    undo.message_before = pickLink(message);
    // Events first, as the page does: a failure leaves the link whole.
    const unlinked = await unlinkMessageFromApplication(jobsDb(env), env.userId, applicationId, messageId);
    undo.events_removed = unlinked.eventsRemoved;
    if (unlinked.unlinked) undo.message_after = { ...UNLINKED_BY_HAND };
    undo.dismissal_added = unlinked.dismissalId;
    if (unlinked.error || !unlinked.dismissalId) {
      return backOut(new Error(`Unlinking the email failed: ${unlinked.error ?? 'the decline was not kept'}`), 'unlink');
    }
    summary = `Dash took ${subject} off the role${onRole}; it is back in the review queue.`;
    verb = 'Unlinked';
    rest = `${onRole}, back in the review queue`;
  }

  const href = role ? roleHref(role.id) : '/jobs';
  return {
    kind: 'change_role_email',
    input: { verb, what: subject, rest, href, where: role ? 'Open the role' : 'Open Jobs', paths: [...(role ? rolePaths(role.id) : ['/jobs']), '/jobs/review'] },
    subjectRef: toRef(APPLICATIONS, applicationId),
    op: 'update',
    before: application,
    after: application,
    summary,
    row: { table: MESSAGES, ref: messageId, title: subject, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

function roleEmailUndo(value: Record<string, unknown> | null): RoleEmailUndo | null {
  if (!value || typeof value.message_id !== 'string') return null;
  const object = (key: string) => (value[key] && typeof value[key] === 'object' ? (value[key] as Row) : null);
  const ids = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]).filter((id): id is string => typeof id === 'string') : []);
  const removed = Array.isArray(value.events_removed) ? (value.events_removed as Row[]) : [];
  const added = object('interview_added');
  const undo: RoleEmailUndo = {
    message_id: value.message_id,
    message_before: object('message_before'),
    message_after: object('message_after'),
    events_removed: removed.filter((row) => row && typeof row.id === 'string'),
    events_added: ids('events_added'),
    dismissal_added: typeof value.dismissal_added === 'string' ? value.dismissal_added : null,
    interview_added:
      added && typeof added.interview_id === 'string'
        ? { interview_id: added.interview_id, group_id: typeof added.group_id === 'string' ? added.group_id : null }
        : null,
  };
  const count =
    (undo.message_before ? 1 : 0) + undo.events_removed.length + undo.events_added.length + (undo.dismissal_added ? 1 : 0) + (undo.interview_added ? 1 : 0);
  return count > 0 ? undo : null;
}

/** Put back what a role email change kept; how many rows went back. */
async function putBackRoleEmail(deps: { userId: string; db: AskDb }, undo: RoleEmailUndo): Promise<number> {
  const jobs = await deps.db('job_search');
  let restored = 0;

  // The message goes back only while it still holds what Dash left, and only
  // if it shows in the person's inbox view, which is where its owner is read.
  if (undo.message_before && undo.message_after) {
    const { data: own } = await jobs.from('inbox_messages').select('id').eq('id', undo.message_id).eq('user_id', deps.userId).maybeSingle();
    if (own) {
      let query = jobs.from('ingested_messages').update(undo.message_before).eq('id', undo.message_id);
      for (const [column, value] of Object.entries(undo.message_after)) {
        query = value === null ? query.is(column, null) : query.eq(column, value as string | number);
      }
      const { data, error } = await query.select('id');
      if (error) throw new Error(`ingested_messages: ${error.message}`);
      restored += (data ?? []).length;
    }
  }
  for (const row of undo.events_removed) {
    if (row.user_id !== deps.userId) continue;
    const { data, error } = await jobs.from('application_events').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`application_events: ${error.message}`);
    restored += (data ?? []).length;
  }
  if (undo.events_added.length > 0) {
    const { data, error } = await jobs.from('application_events').delete().eq('user_id', deps.userId).in('id', undo.events_added).select('id');
    if (error) throw new Error(`application_events: ${error.message}`);
    restored += (data ?? []).length;
  }
  if (undo.dismissal_added) {
    const { data, error } = await jobs.from('message_link_dismissals').delete().eq('user_id', deps.userId).eq('id', undo.dismissal_added).select('id');
    if (error) throw new Error(`message_link_dismissals: ${error.message}`);
    restored += (data ?? []).length;
  }
  if (undo.interview_added) {
    // The round the link booked, only while nothing has been set on it.
    const { data, error } = await jobs
      .from('interviews')
      .delete()
      .eq('user_id', deps.userId)
      .eq('id', undo.interview_added.interview_id)
      .is('scheduled_at', null)
      .select('id');
    if (error) throw new Error(`interviews: ${error.message}`);
    restored += (data ?? []).length;
    if (undo.interview_added.group_id && (data ?? []).length > 0) {
      const { error: groupError } = await jobs.from('interview_groups').delete().eq('user_id', deps.userId).eq('id', undo.interview_added.group_id);
      if (groupError) throw new Error(`interview_groups: ${groupError.message}`);
    }
  }
  return restored;
}

/**
 * Undo a link, a turned-down suggestion or an unlink from what it kept
 * (RoleEmailUndo). Ask's undo calls it for every surface (lib/ask/changes.ts,
 * undoMany).
 */
export async function undoRoleEmail(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = roleEmailUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  const restored = await putBackRoleEmail(deps, undo);
  if (restored === 0) {
    return { ok: false, error: 'Everything this changed has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// review_application and review_events
// ---------------------------------------------------------------------------

/**
 * Working the Jobs review queue (plan #1894.6.4.1): an application the inbox
 * found, confirmed as real or reopened by hand, and events flagged as
 * conflicting, acknowledged or taken back. Each can touch more than one row
 * (a reopen writes the application and a status_override event; an
 * acknowledgement can take a whole selection), so the record keeps every row
 * in `undo` as RowsUndo and undoJobsRows puts them back.
 */
export type RowsUndo = {
  /** Rows changed in place: `before` is put back where the row still holds `after`. */
  updated: { table: string; id: string; before: Row; after: Row }[];
  /** Rows the change wrote, taken out again once every update has gone back. */
  inserted: { table: string; id: string }[];
};

/**
 * The tables a review change's undo may name. All but the email verdicts
 * keep a user_id; an email's owner is read through job_search.inbox_messages.
 */
const ROWS_TABLES = new Set([APPLICATIONS, 'job_search.application_events', 'job_search.ingested_messages']);

const REVIEW_HREF = '/jobs/review';
const EVENTS_MAX = 50;
const REOPEN_STATUSES = ['in_process', 'final_round'] as const;

async function reviewApplication(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const verb = text(args, 'verb');
  if (verb !== 'confirm' && verb !== 'reopen') throw new JobsRefused('verb must be confirm or reopen.');
  const before = await namedApplication(env, args);
  const id = before.id as string;
  const undo: RowsUndo = { updated: [], inserted: [] };
  let label = '';

  if (verb === 'confirm') {
    if (given(args, 'status')) throw new JobsRefused('status goes with reopen.');
    if (before.needs_review !== true) throw new JobsRefused('That application is not waiting to be confirmed.');
    // The same write as the review queue's Confirm.
    const { error } = await confirmApplicationRow(jobsDb(env), env.userId, id);
    if (error) throw new Error(`Confirming the application failed: ${error}`);
    undo.updated.push({ table: APPLICATIONS, id, before: { needs_review: true }, after: { needs_review: false } });
  } else {
    const status = oneOf(args, 'status', REOPEN_STATUSES, false) as (typeof REOPEN_STATUSES)[number];
    if (!TERMINAL_STATUSES.includes(before.status as ApplicationStatus)) {
      throw new JobsRefused('That pursuit is not closed, so there is nothing to reopen. Moving it to another stage is move_roles.');
    }
    label = status.replace(/_/g, ' ');
    // As the page reopens one: the event says so on the timeline, and the override sets the stage.
    const { eventId, error } = await reopenApplicationRows(jobsDb(env), env.userId, id, status);
    if (error || !eventId) throw new Error(`Reopening the application failed: ${error ?? 'no event'}`);
    undo.inserted.push({ table: 'job_search.application_events', id: eventId });
    undo.updated.push({
      table: APPLICATIONS,
      id,
      before: { status_manual_override: before.status_manual_override ?? null },
      after: { status_manual_override: status },
    });
  }

  const after = await ownRow(env.jobs, 'applications', id, env.userId, 'application');
  const roleId = before.role_id as string;
  const role = await ownRow(env.jobs, 'roles', roleId, env.userId, 'role');
  const name = roleName(role, await companyName(env, role.company_id));
  const href = roleHref(roleId);
  return {
    kind: 'review_application',
    input: {
      verb: verb === 'confirm' ? 'Confirmed' : 'Reopened',
      what: name,
      rest: verb === 'confirm' ? ' as a real pursuit, from Jobs review' : ` as ${label}`,
      href,
      where: 'Open the role',
      paths: [...rolePaths(roleId), REVIEW_HREF],
    },
    subjectRef: toRef(APPLICATIONS, id),
    op: 'update',
    before,
    after,
    summary: verb === 'confirm' ? `Dash confirmed ${name} as a real pursuit, from Jobs review.` : `Dash reopened the pursuit ${name} as ${label}.`,
    row: { table: ROLES, ref: roleId, title: name, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

async function reviewEvents(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const verb = text(args, 'verb');
  if (verb !== 'acknowledge' && verb !== 'take_back') throw new JobsRefused('verb must be acknowledge or take_back.');
  const refs = Array.isArray(args.event_refs) ? args.event_refs : [];
  if (refs.length === 0) throw new JobsRefused('Name the events: event_refs, as list_rows on job_search.application_events returned them.');
  if (refs.length > EVENTS_MAX) throw new JobsRefused(`Up to ${EVENTS_MAX} events at a time.`);
  const ids = [...new Set(refs.map((ref) => idOf(typeof ref === 'string' ? ref.trim() : '', 'event')))];

  const { data, error: readError } = await env.jobs.from('application_events').select('*').in('id', ids).eq('user_id', env.userId);
  if (readError) throw new Error(`Reading the events failed: ${readError.message}`);
  const found = (data ?? []) as Row[];
  if (found.length < ids.length) throw new JobsRefused('One of those is not an event of theirs. Look them up first.');
  const events =
    verb === 'acknowledge' ? found.filter((row) => row.needs_review === true) : found.filter((row) => row.acknowledged_at != null);
  if (events.length === 0) {
    throw new JobsRefused(verb === 'acknowledge' ? 'None of those is flagged for review.' : 'None of those has been acknowledged.');
  }

  const changed = events.map((row) => row.id as string);
  // The same writes as the review queue's acknowledge and its Undo.
  const { rows: written, error } =
    verb === 'acknowledge' ? await acknowledgeEventRows(jobsDb(env), env.userId, changed) : await unacknowledgeEventRows(jobsDb(env), env.userId, changed);
  if (error) throw new Error(`Changing the events failed: ${error}`);
  const afterById = new Map(written.map((row) => [row.id as string, row]));

  // Matched on acknowledged_at alone: the sync trigger may re-derive the flag, and the stamp is what this wrote.
  const undo: RowsUndo = {
    updated: events.map((row) => ({
      table: 'job_search.application_events',
      id: row.id as string,
      before: { needs_review: row.needs_review, acknowledged_at: row.acknowledged_at ?? null },
      after: { acknowledged_at: afterById.get(row.id as string)?.acknowledged_at ?? null },
    })),
    inserted: [],
  };

  const first = events[0];
  const roles = new Set(events.map((row) => row.application_id));
  const role = roles.size === 1 ? await applicationRole(env, first.application_id) : null;
  const what = events.length === 1 ? quotedBody(first.summary, 'the event') : `${events.length} events`;
  const done = verb === 'acknowledge' ? 'acknowledged' : 'took back the acknowledgement of';
  const href = role ? roleHref(role.id) : REVIEW_HREF;
  return {
    kind: 'review_events',
    input: {
      verb: verb === 'acknowledge' ? 'Acknowledged' : 'Flagged again',
      what,
      rest: role ? ` on ${role.name}, in Jobs review` : ', in Jobs review',
      href: REVIEW_HREF,
      where: 'Open Jobs review',
      paths: [REVIEW_HREF, ...(role ? rolePaths(role.id) : [])],
    },
    subjectRef: toRef('job_search.application_events', first.id as string),
    op: 'update',
    before: first,
    after: afterById.get(first.id as string) ?? first,
    summary: `Dash ${done} ${what}${role ? ` on ${role.name}` : ''} in Jobs review.`,
    row: { table: 'job_search.application_events', ref: first.id as string, title: what, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// review_emails
// ---------------------------------------------------------------------------

/**
 * Emails waiting in Jobs review dismissed, or dismissed ones brought back
 * (plan #1894.6.4.2). A dismissal writes what the page's d key and bulk bar
 * write: the email is marked not relevant and skipped, and its suggested
 * link is cleared. Bringing one back puts it in the queue again with the
 * classification it now has, or the one the call gives. The record keeps
 * every email's classification and link from before, so the Undo puts each
 * back as it was, whichever way the change went.
 *
 * The verdict rows have no user_id; the person's ownership is read through
 * job_search.inbox_messages, which carries it, as change_role_email does.
 */
const MESSAGE_COLUMNS = ['classification', 'parse_status', 'resulting_application_id', 'link_method', 'link_confidence', 'error'] as const;
const EMAILS_MAX = 50;
const pickMessage = (row: Row): Row => Object.fromEntries(MESSAGE_COLUMNS.map((column) => [column, row[column] ?? null]));

/** The emails a call names, read through the inbox view by the person's user id; refused unless every one is theirs. */
async function namedEmails(env: JobsWriteEnv, refs: unknown): Promise<Row[]> {
  const list = Array.isArray(refs) ? refs : [];
  if (list.length === 0) throw new JobsRefused('Name the emails: email_refs, as search_mail or a lookup returned them.');
  if (list.length > EMAILS_MAX) throw new JobsRefused(`Up to ${EMAILS_MAX} emails at a time.`);
  const byId = new Map<string, Row>();
  for (const raw of list) {
    let ref = typeof raw === 'string' ? raw.trim() : '';
    if (ref.startsWith('job_search.inbox_messages:')) ref = ref.slice('job_search.inbox_messages:'.length);
    let query = env.jobs.from('inbox_messages').select('*').eq('user_id', env.userId);
    if (isUuid(ref)) query = query.eq('id', ref);
    else {
      const at = ref.indexOf(':');
      if (at <= 0 || !isUuid(ref.slice(0, at))) throw new JobsRefused('Each of email_refs must be the ref search_mail or a lookup returned for the email.');
      query = query.eq('email_account_id', ref.slice(0, at)).eq('provider_message_id', ref.slice(at + 1));
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Reading the email failed: ${error.message}`);
    if (!data) throw new JobsRefused('One of those is not an email the job search has read. Look them up first.');
    byId.set((data as Row).id as string, data as Row);
  }
  return [...byId.values()];
}

async function reviewEmails(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const verb = text(args, 'verb');
  if (verb !== 'dismiss' && verb !== 'restore') throw new JobsRefused('verb must be dismiss or restore.');
  if (verb === 'dismiss' && given(args, 'classification')) throw new JobsRefused('classification goes with restore.');
  const classification = given(args, 'classification')
    ? (oneOf(args, 'classification', CLASSIFICATIONS.filter((c) => c !== 'not_relevant'), false) as MessageClassification)
    : null;
  const found = await namedEmails(env, args.email_refs);
  const emails =
    verb === 'dismiss'
      ? found.filter((row) => row.parse_status === 'needs_review')
      : found.filter((row) => row.parse_status === 'skipped' && row.classification === 'not_relevant');
  if (emails.length === 0) {
    throw new JobsRefused(verb === 'dismiss' ? 'None of those is waiting in Jobs review.' : 'None of those has been dismissed.');
  }

  const undo: RowsUndo = { updated: [], inserted: [] };
  let firstAfter: Row | null = null;
  for (const row of emails) {
    // The same writes as the review queue's d key, bulk bar and its Undo.
    const set: Row = { parse_status: 'needs_review', ...(classification ? { classification } : {}) };
    const { rows: written, error } =
      verb === 'dismiss' ? await dismissMessageRows(jobsDb(env), [row.id as string]) : await restoreMessageRow(jobsDb(env), row.id as string, set);
    if (error) throw new Error(`Changing the email failed: ${error}`);
    const after = written[0];
    if (!after) continue;
    firstAfter ??= after;
    undo.updated.push({ table: MESSAGES, id: row.id as string, before: pickMessage(row), after: pickMessage(after) });
  }
  if (!firstAfter) throw new Error('Changing the emails failed: no row was written.');

  const first = emails[0];
  const what = emails.length === 1 ? quotedBody(first.subject, 'an email') : `${emails.length} emails`;
  const label = classification ? classification.replace(/_/g, ' ') : null;
  return {
    kind: 'review_emails',
    input: {
      verb: verb === 'dismiss' ? 'Dismissed' : 'Brought back',
      what,
      rest: verb === 'dismiss' ? ' from Jobs review' : ` to Jobs review${label ? ` as ${label}` : ''}`,
      href: REVIEW_HREF,
      where: 'Open Jobs review',
      paths: [REVIEW_HREF],
    },
    subjectRef: toRef('job_search.inbox_messages', first.id as string),
    op: 'update',
    before: first,
    after: firstAfter,
    summary:
      verb === 'dismiss'
        ? `Dash dismissed ${what} from Jobs review.`
        : `Dash brought back ${what} to Jobs review${label ? ` as ${label}` : ''}.`,
    row: { table: 'job_search.inbox_messages', ref: first.id as string, title: what, href: REVIEW_HREF },
    undo: undo as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// add_role_from_email
// ---------------------------------------------------------------------------

/**
 * A new role made from an email in Jobs review (plan #1894.6.4.3), as the
 * page's "new role" option does: the company is found by name or added, the
 * role and its application are made with the channel the email implies, and
 * the email is linked to the application by change_role_email's link, which
 * files the event its classification implies. Linking an email to a role on
 * file is change_role_email itself.
 *
 * The record keeps the link's own undo (RoleEmailUndo) and the rows made.
 * The Undo puts the email back in the queue, then takes the application, the
 * role and an added company out, each only while nothing has come to hang on
 * it since, so a note or an interview added in between is never lost.
 */
export type RoleFromEmailUndo = {
  email: RoleEmailUndo | null;
  application_id: string;
  role_id: string;
  /** The company, when this change added it. */
  company_added: string | null;
};

async function addRoleFromEmail(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const title = text(args, 'title');
  if (!title) throw new JobsRefused('Give title: what the role is called.');
  if (title.length > TITLE_MAX) throw new JobsRefused(`Keep title under ${TITLE_MAX} characters.`);
  const companyGiven = text(args, 'company');
  if (!companyGiven) throw new JobsRefused('Give company: which company the role is at.');
  if (companyGiven.length > COMPANY_MAX) throw new JobsRefused(`Keep company under ${COMPANY_MAX} characters.`);
  let emailRef = text(args, 'email_ref');
  if (emailRef.startsWith('job_search.inbox_messages:')) emailRef = emailRef.slice('job_search.inbox_messages:'.length);
  if (!emailRef) throw new JobsRefused('Name the email: email_ref, the ref search_mail or a lookup returned.');
  const email = await namedEmail(env, emailRef);
  const messageId = email.id as string;
  const { data: stored, error: storedError } = await env.jobs.from('ingested_messages').select('resulting_application_id').eq('id', messageId).maybeSingle();
  if (storedError) throw new Error(`Reading the email failed: ${storedError.message}`);
  if (!stored) throw new JobsRefused('That email is no longer in the mailbox.');
  if ((stored as Row).resulting_application_id) {
    throw new JobsRefused('That email is linked to a role already. Unlink it there first with change_role_email.');
  }

  const { data: onFile, error: companyError } = await env.jobs
    .from('companies')
    .select('id, name')
    .eq('user_id', env.userId)
    .eq('slug', slugify(companyGiven))
    .maybeSingle();
  if (companyError) throw new Error(`Reading the company failed: ${companyError.message}`);
  if (onFile) {
    const { data: same, error: sameError } = await env.jobs.from('roles').select('id, title').eq('user_id', env.userId).eq('company_id', (onFile as Row).id as string);
    if (sameError) throw new Error(`Reading the roles failed: ${sameError.message}`);
    const twin = ((same ?? []) as Row[]).find((role) => typeof role.title === 'string' && role.title.trim().toLowerCase() === title.toLowerCase());
    if (twin) {
      throw new JobsRefused(`${roleName(twin, (onFile as Row).name as string)} is on file already (role ${twin.id as string}). Link the email to it with change_role_email instead.`);
    }
  }

  const undo: RoleFromEmailUndo = { email: null, application_id: '', role_id: '', company_added: null };
  const backOut = async (error: unknown): Promise<never> => {
    try {
      await putBackRoleFromEmail({ userId: env.userId, db: async () => env.jobs }, undo);
    } catch (putBack) {
      console.error('add_role_from_email: putting a failed change back failed', putBack);
    }
    throw error;
  };

  let companyId = onFile ? ((onFile as Row).id as string) : '';
  if (!companyId) {
    const company = await ensureCompany(env.jobs as unknown as AppSupabaseClient, env.userId, companyGiven);
    if (company.error) throw new Error(`Adding the company failed: ${company.error}`);
    companyId = company.id;
    if (company.created) undo.company_added = company.id;
  }

  // Recruiter inbound only when the recruiter wrote first, as the page decides.
  const channel = channelForMessage(email.classification as string | null);
  // The same pursuit as the review queue's "new role" makes; it takes its own role back when the application fails.
  const made = await addPursuitFromMail(jobsDb(env), env.userId, { companyId, title, channel });
  if (made.error || !made.role || !made.applicationId) return backOut(new Error(`Adding the role failed: ${made.error ?? 'no row'}`));
  const role = made.role;
  undo.role_id = role.id as string;
  undo.application_id = made.applicationId;

  const linked = await runJobsWrite(changeRoleEmailWrite(), env, { action: 'link', application_ref: undo.application_id, email_ref: messageId });
  if ('ok' in linked) return backOut(new Error(`Linking the email failed: ${linked.error}`));
  undo.email = roleEmailUndo(linked.undo);

  const roleId = undo.role_id;
  const name = roleName(role, (onFile as Row | null)?.name ? ((onFile as Row).name as string) : companyGiven);
  const subject = quotedBody(email.subject, 'an email with no subject');
  const href = roleHref(roleId);
  return {
    kind: 'add_role_from_email',
    input: {
      verb: 'Made',
      what: name,
      rest: ` from ${subject}, and linked the email to it`,
      href,
      where: 'Open the role',
      paths: [...rolePaths(roleId), REVIEW_HREF],
    },
    subjectRef: toRef(ROLES, roleId),
    op: 'insert',
    before: null,
    after: role,
    summary: `Dash made the role ${name} from ${subject} in Jobs review${undo.company_added ? ', adding the company,' : ''} and linked the email to it.`,
    row: { table: ROLES, ref: roleId, title: name, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

/** change_role_email's entry, which the link runs through. */
const changeRoleEmailWrite = (): JobsWrite => JOBS_WRITES.find((write) => write.name === 'change_role_email')!;

function roleFromEmailUndo(value: Record<string, unknown> | null): RoleFromEmailUndo | null {
  if (!value || typeof value.role_id !== 'string' || !isUuid(value.role_id)) return null;
  const email = value.email && typeof value.email === 'object' ? roleEmailUndo(value.email as Record<string, unknown>) : null;
  return {
    email,
    application_id: typeof value.application_id === 'string' && isUuid(value.application_id) ? value.application_id : '',
    role_id: value.role_id,
    company_added: typeof value.company_added === 'string' && isUuid(value.company_added) ? value.company_added : null,
  };
}

/** What hangs on an application or a role and would go with it: the Undo leaves a row that holds any. */
const APPLICATION_HOLDERS: readonly { schema: AskSchema; table: string; column: string; owned: boolean }[] = [
  { schema: 'job_search', table: 'application_events', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'interviews', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'interview_groups', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'contact_touches', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'notes', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'attachments', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'application_answers', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'cover_letters', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'reminders', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'ingested_messages', column: 'resulting_application_id', owned: false },
  { schema: 'job_search', table: 'message_link_dismissals', column: 'application_id', owned: true },
  { schema: 'job_search', table: 'quiet_dismissals', column: 'application_id', owned: true },
  { schema: 'todo', table: 'task_links', column: 'application_id', owned: false },
];
const ROLE_HOLDERS: readonly { schema: AskSchema; table: string; column: string; owned: boolean }[] = [
  { schema: 'job_search', table: 'applications', column: 'role_id', owned: true },
  { schema: 'job_search', table: 'notes', column: 'role_id', owned: true },
  { schema: 'job_search', table: 'attachments', column: 'role_id', owned: true },
  { schema: 'job_search', table: 'suggestions', column: 'role_id', owned: true },
  { schema: 'todo', table: 'task_links', column: 'role_id', owned: false },
];

/** Whether any row other than `except` hangs on the row `id`. */
async function held(deps: { userId: string; db: AskDb }, holders: typeof ROLE_HOLDERS, id: string, except: Set<string>): Promise<boolean> {
  for (const holder of holders) {
    let query = (await deps.db(holder.schema)).from(holder.table).select('id').eq(holder.column, id);
    if (holder.owned) query = query.eq('user_id', deps.userId);
    const { data, error } = await query.limit(except.size + 1);
    if (error) throw new Error(`${holder.table}: ${error.message}`);
    if (((data ?? []) as Row[]).some((row) => !except.has(row.id as string))) return true;
  }
  return false;
}

/** Put the email back, then take out the application, the role and an added company nothing else holds; how many rows went back or out. */
async function putBackRoleFromEmail(deps: { userId: string; db: AskDb }, undo: RoleFromEmailUndo): Promise<number> {
  const jobs = await deps.db('job_search');
  let restored = undo.email ? await putBackRoleEmail(deps, undo.email) : 0;
  const takeOut = async (table: string, id: string) => {
    const { data, error } = await jobs.from(table).delete().eq('id', id).eq('user_id', deps.userId).select('id');
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).length;
  };
  if (undo.application_id) restored += await takeOut('applications', undo.application_id);
  if (undo.role_id) restored += await takeOut('roles', undo.role_id);
  if (undo.company_added && !(await companyHeld(deps, undo.company_added))) {
    restored += await takeOut('companies', undo.company_added);
  }
  return restored;
}

/**
 * Undo a role made from an email (RoleFromEmailUndo). Before anything is
 * changed, the application and the role are checked for rows that came to
 * hang on them after the link (a note, a reminder, an interview with a time
 * set, another email), and the Undo is refused while there is one, since
 * taking the role out would take those with it. Ask's undo calls it for
 * every surface (lib/ask/changes.ts, undoMany).
 */
export async function undoRoleFromEmail(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = roleFromEmailUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this made, so it cannot be undone.' };
  const jobs = await deps.db('job_search');
  const { data: role, error } = await jobs.from('roles').select('id').eq('id', undo.role_id).eq('user_id', deps.userId).maybeSingle();
  if (error) throw new Error(`roles: ${error.message}`);
  if (!role) return { ok: false, error: 'That role has been taken out since, so there is nothing to undo.' };

  // The rows the link itself wrote do not count; a round it booked counts once a time is set on it.
  const own = new Set<string>([...(undo.email?.events_added ?? []), undo.email?.message_id ?? '', undo.application_id]);
  const round = undo.email?.interview_added;
  if (round) {
    const { data: interview } = await jobs.from('interviews').select('id, scheduled_at').eq('id', round.interview_id).eq('user_id', deps.userId).maybeSingle();
    if (interview && (interview as Row).scheduled_at == null) {
      own.add(round.interview_id);
      if (round.group_id) own.add(round.group_id);
    }
  }
  if ((undo.application_id && (await held(deps, APPLICATION_HOLDERS, undo.application_id, own))) || (await held(deps, ROLE_HOLDERS, undo.role_id, own))) {
    return { ok: false, error: 'The role has gathered more since, such as a note or another email, so undoing would lose it.' };
  }
  const restored = await putBackRoleFromEmail(deps, undo);
  return { ok: true, restored };
}

function rowsUndo(value: Record<string, unknown> | null): RowsUndo | null {
  if (!value) return null;
  const updated = Array.isArray(value.updated) ? (value.updated as RowsUndo['updated']) : [];
  const inserted = Array.isArray(value.inserted) ? (value.inserted as RowsUndo['inserted']) : [];
  const ok =
    updated.every((row) => ROWS_TABLES.has(row.table) && isUuid(row.id) && row.before && row.after) &&
    inserted.every((row) => ROWS_TABLES.has(row.table) && isUuid(row.id));
  return ok && updated.length + inserted.length > 0 ? { updated, inserted } : null;
}

/**
 * Undo a review change from what its record kept (RowsUndo): each row goes
 * back where it still holds what Dash left, and the rows the change wrote
 * come out only when every one did, so a reopen whose pursuit has moved on
 * since keeps its timeline line. Ask's undo calls it for every surface
 * (lib/ask/changes.ts, undoMany).
 */
export async function undoJobsRows(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = rowsUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this change touched, so it cannot be undone.' };
  const jobs = await deps.db('job_search');
  const name = (table: string) => table.slice('job_search.'.length);
  let restored = 0;
  for (const row of undo.updated) {
    let query = jobs.from(name(row.table)).update(row.before).eq('id', row.id);
    if (row.table === 'job_search.ingested_messages') {
      const { data: own } = await jobs.from('inbox_messages').select('id').eq('id', row.id).eq('user_id', deps.userId).maybeSingle();
      if (!own) continue;
    } else query = query.eq('user_id', deps.userId);
    for (const [column, value] of Object.entries(row.after)) {
      if (!scalar(value)) continue;
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  if (restored < undo.updated.length && undo.inserted.length > 0) {
    return { ok: false, error: 'That pursuit has changed again since, so undoing would lose the later change.' };
  }
  for (const row of undo.inserted) {
    const { data, error } = await jobs.from(name(row.table)).delete().eq('id', row.id).eq('user_id', deps.userId).select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  if (restored === 0) {
    return { ok: false, error: 'Everything this change touched has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}


// ---------------------------------------------------------------------------
// change_contact, change_touch, mark_suggestion_sent
// ---------------------------------------------------------------------------

const CONTACTS = 'job_search.contacts';
const TOUCHES = 'job_search.contact_touches';
const SUGGESTIONS = 'job_search.suggestions';

const RELATIONSHIPS = CONTACT_RELATIONSHIPS;
const DIRECTIONS = ['outbound', 'inbound'] as const;
const NAME_MAX = 200;
const NOTES_MAX = 20_000;
const MESSAGE_MAX = 10_000;

const contactHref = (id: string) => `/jobs/contacts/${id}`;
const contactPaths = (id: string) => ['/jobs/contacts', contactHref(id), '/jobs/companies'];

function contactName(contact: Row): string {
  const name = typeof contact.full_name === 'string' && contact.full_name.trim() ? contact.full_name.trim() : 'the contact';
  return name.length > 100 ? `${name.slice(0, 99).trimEnd()}…` : name;
}

/** A link or an address, checked the way the contact form checks it. */
function contactLink(args: Args, key: string, kind: 'url' | 'email'): string | null {
  const value = clearable(args, key, LINK_MAX);
  if (value === null) return null;
  if (kind === 'url' && !/^https?:\/\/\S+$/i.test(value)) throw new JobsRefused(`${key} must be a link starting http:// or https://.`);
  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new JobsRefused(`${key} must be an email address.`);
  return value;
}

/**
 * A contact added or corrected, as the contacts page and a contact's page do:
 * name, title, company, LinkedIn page, work email, how they know them and
 * notes. There is nowhere for a personal phone number or a home address, as
 * on the page. A company named that is not on file is added, as change_role
 * does, and the Undo leaves it.
 */
async function changeContact(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const ref = text(args, 'contact_ref');
  const before = ref ? await ownRow(env.jobs, 'contacts', idOf(ref, 'contact'), env.userId, 'contact') : null;
  const values: Row = {};

  if (given(args, 'full_name') || !before) {
    const name = text(args, 'full_name');
    if (!name) throw new JobsRefused(before ? 'A contact needs a name: give full_name, or leave it out.' : 'Give full_name: a contact needs a name.');
    if (name.length > NAME_MAX) throw new JobsRefused(`Keep full_name under ${NAME_MAX} characters.`);
    values.full_name = name;
  }
  if (given(args, 'title')) values.title = clearable(args, 'title', FIELD_MAX);
  if (given(args, 'linkedin_url')) values.linkedin_url = contactLink(args, 'linkedin_url', 'url');
  if (given(args, 'email')) values.email = contactLink(args, 'email', 'email');
  if (given(args, 'relationship')) values.relationship = oneOf(args, 'relationship', RELATIONSHIPS, false);
  if (given(args, 'how_we_connect')) values.how_we_connect = clearable(args, 'how_we_connect', NOTES_MAX);
  if (given(args, 'notes')) values.notes = clearable(args, 'notes', NOTES_MAX);
  if (given(args, 'potential_lead')) {
    if (typeof args.potential_lead !== 'boolean') throw new JobsRefused('potential_lead is true or false.');
    values.potential_lead = args.potential_lead;
  }
  if (given(args, 'found_by_dash')) {
    if (typeof args.found_by_dash !== 'boolean') throw new JobsRefused('found_by_dash is true or false.');
    values.found_by_dash = args.found_by_dash;
  }
  if (given(args, 'company')) {
    const name = clearable(args, 'company', COMPANY_MAX);
    if (name === null) values.company_id = null;
    else {
      const company = await ensureCompany(env.jobs as unknown as AppSupabaseClient, env.userId, name);
      if (company.error) throw new Error(`Finding the company failed: ${company.error}`);
      values.company_id = company.id;
    }
  }

  const undo: ContactRowsUndo = { added: [], changed: [] };
  let after: Row;
  if (before) {
    const update = Object.fromEntries(Object.entries(values).filter(([key, value]) => before[key] !== value));
    if (Object.keys(update).length === 0) {
      throw new JobsRefused('Nothing to change: give full_name, title, company, linkedin_url, email, relationship, how_we_connect, notes, potential_lead or found_by_dash, with a new value.');
    }
    // The same writes as the contact page's fields and the Add contact form.
    const written = await changedBy(undo, 'contacts', before, update, saveContactEdit(jobsDb(env), env.userId, before.id as string, update));
    if (!written) throw new Error('Changing the contact failed: no row');
    after = written;
  } else {
    after = await addedBy(undo, 'contacts', addContact(jobsDb(env), env.userId, values));
  }

  const id = after.id as string;
  const name = contactName(after);
  const company = await companyName(env, after.company_id);
  const at = company ? ` at ${company}` : '';
  return {
    kind: 'change_contact',
    input: {
      verb: before ? 'Updated' : 'Added',
      what: name,
      rest: before ? `${at} in your contacts` : `${at} to your contacts`,
      href: contactHref(id),
      where: 'Open the contact',
      paths: contactPaths(id),
    },
    subjectRef: toRef(CONTACTS, id),
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: before ? `Dash updated the contact ${name}${at}.` : `Dash added ${name}${at} to the contacts.`,
    row: { table: CONTACTS, ref: id, title: name, href: contactHref(id) },
    undo: undo as unknown as Record<string, unknown>,
  };
}

/**
 * What a touch logged, edited or answered, or a suggestion marked sent,
 * keeps in `undo`: the rows it added, in order, and for each row it changed
 * the columns it wrote, before and after. The Undo (undoContactRows) puts a
 * changed row back while it still holds what Dash left, and takes an added
 * row out, newest first, so a touch goes before the contact it hangs on.
 */
export type ContactRowsUndo = {
  added: { table: string; id: string }[];
  changed: { table: string; id: string; before: Row; after: Row }[];
};

/** The tables these writes touch, the only ones their Undo will write to. */
const CONTACT_TABLES = new Set(['contacts', 'contact_touches', 'suggestions']);

/** Change one row of theirs, keeping the columns written before and after. */
async function changeKept(env: JobsWriteEnv, undo: ContactRowsUndo, table: string, row: Row, update: Row, only?: { column: string; values: string[] }): Promise<Row | null> {
  let query = env.jobs.from(table).update(update).eq('id', row.id as string).eq('user_id', env.userId);
  if (only) query = query.in(only.column, only.values);
  const { data, error } = await query.select('*');
  if (error) throw new Error(`Changing ${table} failed: ${error.message}`);
  const written = ((data ?? []) as Row[])[0];
  if (!written) return null;
  undo.changed.push({
    table,
    id: row.id as string,
    before: Object.fromEntries(Object.keys(update).map((column) => [column, row[column] ?? null])),
    after: Object.fromEntries(Object.keys(update).map((column) => [column, written[column] ?? null])),
  });
  return written;
}

/** A row a shared write changed, kept with the columns it wrote before and after. */
async function changedBy(
  undo: ContactRowsUndo,
  table: string,
  row: Row,
  update: Row,
  write: Promise<{ row: Row | null; error: string | null }>,
): Promise<Row | null> {
  const { row: written, error } = await write;
  if (error) throw new Error(`Changing ${table} failed: ${error}`);
  if (!written) return null;
  undo.changed.push({
    table,
    id: row.id as string,
    before: Object.fromEntries(Object.keys(update).map((column) => [column, row[column] ?? null])),
    after: Object.fromEntries(Object.keys(update).map((column) => [column, written[column] ?? null])),
  });
  return written;
}

/** A row a shared write added, kept so the Undo takes it out. */
async function addedBy(undo: ContactRowsUndo, table: string, write: Promise<{ row: Row | null; error: string | null }>): Promise<Row> {
  const { row, error } = await write;
  if (error || !row) throw new Error(`Adding to ${table} failed: ${error ?? 'no row'}`);
  undo.added.push({ table, id: row.id as string });
  return row;
}

const jobsDb = (env: JobsWriteEnv) => env.jobs as unknown as AppSupabaseClient;

/** A failed write of several rows puts back what it had done, then fails. */
async function backOutContact(env: JobsWriteEnv, undo: ContactRowsUndo, error: unknown, kind: string): Promise<never> {
  try {
    await putBackContactRows({ userId: env.userId, db: async () => env.jobs }, undo);
  } catch (putBack) {
    console.error(`${kind}: putting a failed change back failed`, putBack);
  }
  throw error;
}

/** "a LinkedIn message", for the words a touch is told in. */
const CHANNEL_WORDS: Record<string, string> = {
  linkedin_dm: 'a LinkedIn message',
  linkedin_connect: 'a LinkedIn connection request',
  email: 'an email',
  intro: 'an introduction',
  event: 'a meeting at an event',
  other: 'a message',
};

/**
 * The outreach log on a contact's page: a touch logged (a send moves a
 * contact still to be contacted to contacted, as the page does), a touch's
 * channel or words corrected, or a touch marked answered (the contact moves
 * to responded). Nothing is sent: the log records what they did.
 */
async function changeTouch(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const action = text(args, 'action');
  if (action !== 'log' && action !== 'edit' && action !== 'sent' && action !== 'answered') {
    throw new JobsRefused('action must be log, edit, sent or answered.');
  }
  const undo: ContactRowsUndo = { added: [], changed: [] };

  let touch: Row;
  let contact: Row;
  let touchBefore: Row | null = null;
  if (action === 'log') {
    contact = await ownRow(env.jobs, 'contacts', idOf(text(args, 'contact_ref'), 'contact'), env.userId, 'contact');
    const channel = given(args, 'channel') ? oneOf(args, 'channel', TOUCH_CHANNELS, false) : 'other';
    const direction = given(args, 'direction') ? oneOf(args, 'direction', DIRECTIONS, false) : 'outbound';
    const message = given(args, 'message') ? clearable(args, 'message', MESSAGE_MAX) : null;
    if (given(args, 'draft') && typeof args.draft !== 'boolean') throw new JobsRefused('draft is true or false.');
    const draft = args.draft === true;
    let applicationId: string | null = null;
    if (text(args, 'application_ref')) {
      const application = await ownRow(env.jobs, 'applications', idOf(text(args, 'application_ref'), 'application'), env.userId, 'application');
      applicationId = application.id as string;
    }
    // The same writes as the log's Log a send.
    touch = await addedBy(
      undo,
      'contact_touches',
      addTouch(jobsDb(env), env.userId, { contact_id: contact.id as string, application_id: applicationId, channel: channel as string, direction: direction as 'outbound' | 'inbound', message, draft }),
    );
    // A draft is no send, so it moves nobody along.
    if (direction === 'outbound' && !draft) {
      try {
        await changedBy(undo, 'contacts', contact, { status: 'contacted' }, markContacted(jobsDb(env), env.userId, contact.id as string));
      } catch (error) {
        return backOutContact(env, undo, error, 'change_touch');
      }
    }
  } else {
    const before = await ownRow(env.jobs, 'contact_touches', idOf(text(args, 'touch_ref'), 'touch'), env.userId, 'touch');
    touchBefore = before;
    contact = await ownRow(env.jobs, 'contacts', before.contact_id as string, env.userId, 'contact');
    if (action === 'edit') {
      const update: Row = {};
      if (given(args, 'channel')) update.channel = oneOf(args, 'channel', TOUCH_CHANNELS, false);
      if (given(args, 'message')) update.message = clearable(args, 'message', MESSAGE_MAX);
      const changed = Object.fromEntries(Object.entries(update).filter(([key, value]) => before[key] !== value));
      if (Object.keys(changed).length === 0) throw new JobsRefused('Nothing to change: give a new channel or message.');
      const written = await changedBy(undo, 'contact_touches', before, changed, saveTouchEdit(jobsDb(env), env.userId, before.id as string, changed));
      if (!written) throw new Error('Changing the touch failed: no row');
      touch = written;
    } else if (action === 'sent') {
      // As the log's Mark sent on a draft: it takes now as its sent time.
      if (before.draft !== true) throw new JobsRefused('That touch is sent already; only a draft can be marked sent.');
      const update = { sent_at: new Date().toISOString(), draft: false };
      const written = await changedBy(undo, 'contact_touches', before, update, markDraftSent(jobsDb(env), env.userId, before.id as string));
      if (!written) throw new JobsRefused('That draft was sent or taken out while this ran.');
      touch = written;
      if (written.direction === 'outbound') {
        try {
          await changedBy(undo, 'contacts', contact, { status: 'contacted' }, markContacted(jobsDb(env), env.userId, contact.id as string));
        } catch (error) {
          return backOutContact(env, undo, error, 'change_touch');
        }
      }
    } else {
      if (before.draft === true) throw new JobsRefused('That touch is a draft that has not been sent, so nothing can have answered it.');
      if (before.responded_at) throw new JobsRefused('That touch is marked answered already.');
      const summary = given(args, 'response') ? clearable(args, 'response', MESSAGE_MAX) : null;
      const answered = { responded_at: new Date().toISOString(), response_summary: summary };
      const written = await changedBy(undo, 'contact_touches', before, answered, answerTouch(jobsDb(env), env.userId, before.id as string, summary));
      if (!written) throw new Error('Marking the touch answered failed: no row');
      touch = written;
      try {
        if (contact.status !== 'responded') {
          await changedBy(undo, 'contacts', contact, { status: 'responded' }, saveContactEdit(jobsDb(env), env.userId, contact.id as string, { status: 'responded' }));
        }
      } catch (error) {
        return backOutContact(env, undo, error, 'change_touch');
      }
    }
  }

  const contactId = contact.id as string;
  const name = contactName(contact);
  const how = CHANNEL_WORDS[touch.channel as string] ?? 'a message';
  const said =
    action === 'log'
      ? touch.direction === 'inbound'
        ? `logged ${how} from ${name}`
        : `logged ${how} to ${name}`
      : action === 'edit'
        ? `corrected a logged touch with ${name}`
        : action === 'sent'
          ? `marked the draft of ${how} to ${name} sent`
          : `marked ${name}'s reply to ${how} answered`;
  return {
    kind: 'change_touch',
    input: {
      verb: action === 'log' ? 'Logged' : action === 'edit' ? 'Corrected' : action === 'sent' ? 'Marked sent' : 'Answered',
      what: how,
      rest: action === 'log' || action === 'sent' ? ` ${touch.direction === 'inbound' ? 'from' : 'to'} ${name}` : ` with ${name}`,
      href: contactHref(contactId),
      where: 'Open the contact',
      paths: contactPaths(contactId),
    },
    subjectRef: toRef(TOUCHES, touch.id as string),
    op: action === 'log' ? 'insert' : 'update',
    before: touchBefore,
    after: touch,
    summary: `Dash ${said}, in the outreach log.`,
    row: { table: TOUCHES, ref: touch.id as string, title: `${how} with ${name}`, href: contactHref(contactId) },
    undo: undo as unknown as Record<string, unknown>,
  };
}

/** The suggestion a call names: by its ref, or by the person or line it suggested, among the open ones. */
async function namedSuggestion(env: JobsWriteEnv, args: Args): Promise<Row> {
  const ref = text(args, 'suggestion_ref');
  if (ref) return ownRow(env.jobs, 'suggestions', idOf(ref, 'suggestion'), env.userId, 'suggestion');
  const person = text(args, 'person').toLowerCase();
  if (!person) throw new JobsRefused('Name the suggestion: suggestion_ref, or person for who it suggested they message.');
  const { data, error } = await env.jobs
    .from('suggestions')
    .select('*')
    .eq('user_id', env.userId)
    .eq('kind', 'reach_out')
    .eq('status', 'open');
  if (error) throw new Error(`Reading the suggestions failed: ${error.message}`);
  const open = (data ?? []) as Row[];
  const said = (row: Row) => [row.person_name, row.headline].filter((part): part is string => typeof part === 'string').join(' ').toLowerCase();
  const found = open.filter((row) => said(row).includes(person));
  if (found.length === 1) return found[0];
  const listedNames = open.map((row) => `"${(row.person_name as string | null) ?? (row.headline as string)}" (${row.id as string})`).join('; ');
  if (found.length === 0) throw new JobsRefused(open.length ? `No open suggestion names "${person}". The open ones: ${listedNames}.` : 'There are no open suggestions of people to message.');
  throw new JobsRefused(`More than one open suggestion names "${person}": ${listedNames}. Give suggestion_ref.`);
}

/**
 * Mark a suggested person on Find as messaged, as its Sent press does: the
 * person is added as a contact if they are not one yet, the suggested
 * message is logged as sent to them, and the suggestion is closed. Nothing is
 * sent from here; they sent it themselves.
 */
async function markSuggestionSent(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const suggestion = await namedSuggestion(env, args);
  if (suggestion.kind !== 'reach_out') throw new JobsRefused('That suggestion is a role to apply for, not a person to message.');
  if (suggestion.status !== 'open') throw new JobsRefused(`That suggestion is ${suggestion.status === 'done' ? 'marked sent' : 'closed'} already.`);
  const undo: ContactRowsUndo = { added: [], changed: [] };

  let contact: Row | null = null;
  try {
    if (typeof suggestion.contact_id === 'string') {
      contact = await ownRow(env.jobs, 'contacts', suggestion.contact_id, env.userId, 'contact');
    } else if (typeof suggestion.person_name === 'string' && suggestion.person_name.trim()) {
      const companyId = typeof suggestion.company_name === 'string' && suggestion.company_name.trim()
        ? await ensureCompany(env.jobs as unknown as AppSupabaseClient, env.userId, suggestion.company_name).then((company) => {
            if (company.error) throw new Error(`Finding the company failed: ${company.error}`);
            return company.id;
          })
        : null;
      // The same writes as Find's Sent press.
      contact = await addedBy(undo, 'contacts', addContact(jobsDb(env), env.userId, suggestedContact(suggestion, companyId)));
    }
    if (contact) {
      await addedBy(
        undo,
        'contact_touches',
        addTouch(jobsDb(env), env.userId, {
          contact_id: contact.id as string,
          channel: (suggestion.channel as string | null) ?? 'other',
          direction: 'outbound',
          message: (suggestion.message as string | null) ?? null,
        }),
      );
      if ((BEFORE_CONTACTED_AGAIN as readonly unknown[]).includes(contact.status)) {
        await changedBy(
          undo,
          'contacts',
          contact,
          { status: 'contacted' },
          markContacted(jobsDb(env), env.userId, contact.id as string, BEFORE_CONTACTED_AGAIN),
        );
      }
    }
    const closed: Row = { status: 'done', acted_at: new Date().toISOString() };
    if (contact) closed.contact_id = contact.id;
    const written = await changeKept(env, undo, 'suggestions', suggestion, closed, { column: 'status', values: ['open'] });
    if (!written) throw new JobsRefused('That suggestion was closed while this ran.');
  } catch (error) {
    return backOutContact(env, undo, error, 'mark_suggestion_sent');
  }

  const who = contact ? contactName(contact) : quotedBody(suggestion.headline, 'the suggestion');
  const href = contact ? contactHref(contact.id as string) : '/jobs/find';
  return {
    kind: 'mark_suggestion_sent',
    input: {
      verb: 'Marked sent',
      what: who,
      rest: contact ? ', logged in the outreach log' : ', from Find',
      href,
      where: contact ? 'Open the contact' : 'Open Find',
      paths: ['/jobs/find', ...(contact ? contactPaths(contact.id as string) : [])],
    },
    subjectRef: toRef(SUGGESTIONS, suggestion.id as string),
    op: 'update',
    before: suggestion,
    after: { ...suggestion, status: 'done' },
    summary: contact
      ? `Dash marked the suggestion to message ${who} as sent, logging it in the outreach log${undo.added.some((row) => row.table === 'contacts') ? ' and adding them as a contact' : ''}.`
      : `Dash marked the suggestion ${who} as sent.`,
    row: { table: SUGGESTIONS, ref: suggestion.id as string, title: who, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

function contactRowsUndo(value: Record<string, unknown> | null): ContactRowsUndo | null {
  if (!value) return null;
  const isRow = (row: unknown): row is Row => !!row && typeof row === 'object' && !Array.isArray(row);
  const known = (row: Row) => typeof row.table === 'string' && CONTACT_TABLES.has(row.table) && typeof row.id === 'string' && isUuid(row.id);
  const added = (Array.isArray(value.added) ? value.added : []).filter(isRow).filter(known);
  const changed = (Array.isArray(value.changed) ? value.changed : [])
    .filter(isRow)
    .filter((row) => known(row) && isRow(row.before) && isRow(row.after));
  if (added.length + changed.length === 0) return null;
  return {
    added: added.map((row) => ({ table: row.table as string, id: row.id as string })),
    changed: changed.map((row) => ({ table: row.table as string, id: row.id as string, before: row.before as Row, after: row.after as Row })),
  };
}

/** The rows that hang on a contact and go with it when it is deleted. */
// Two have no user_id of their own; the contact id, which is theirs, is enough.
const CONTACT_HOLDERS: readonly { schema: AskSchema; table: string; owned: boolean }[] = [
  { schema: 'job_search', table: 'contact_touches', owned: true },
  { schema: 'job_search', table: 'notes', owned: true },
  { schema: 'job_search', table: 'reminders', owned: true },
  { schema: 'job_search', table: 'attachments', owned: true },
  { schema: 'job_search', table: 'interview_participants', owned: false },
  { schema: 'job_search', table: 'suggestions', owned: true },
  { schema: 'todo', table: 'task_links', owned: false },
];

/** Whether anything Dash did not add in this change hangs on the contact. */
async function contactHolds(deps: { userId: string; db: AskDb }, contactId: string, addedIds: Set<string>): Promise<boolean> {
  for (const holder of CONTACT_HOLDERS) {
    const client = await deps.db(holder.schema);
    let query = client.from(holder.table).select('id').eq('contact_id', contactId);
    if (holder.owned) query = query.eq('user_id', deps.userId);
    const { data, error } = await query;
    if (error) throw new Error(`${holder.table}: ${error.message}`);
    if (((data ?? []) as Row[]).some((row) => !addedIds.has(row.id as string))) return true;
  }
  return false;
}

/** Put back what a contact write kept; how many rows went back. */
async function putBackContactRows(deps: { userId: string; db: AskDb }, undo: ContactRowsUndo): Promise<number> {
  const jobs = await deps.db('job_search');
  let restored = 0;
  for (const row of [...undo.changed].reverse()) {
    let query = jobs.from(row.table).update(row.before).eq('id', row.id).eq('user_id', deps.userId);
    for (const [column, value] of Object.entries(row.after)) {
      if (!scalar(value)) continue;
      query = value === null ? query.is(column, null) : query.eq(column, value as string | number | boolean);
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  const addedIds = new Set(undo.added.map((row) => row.id));
  for (const row of [...undo.added].reverse()) {
    // Taking a contact out takes everything on it with it (the foreign keys
    // cascade), so one that has gathered anything since stays.
    if (row.table === 'contacts' && (await contactHolds(deps, row.id, addedIds))) continue;
    const { data, error } = await jobs.from(row.table).delete().eq('id', row.id).eq('user_id', deps.userId).select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  return restored;
}

/**
 * Undo a touch logged, edited or answered, or a suggestion marked sent, from
 * what it kept (ContactRowsUndo). Ask's undo calls it for every surface
 * (lib/ask/changes.ts, undoMany).
 */
export async function undoContactRows(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = contactRowsUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  const restored = await putBackContactRows(deps, undo);
  if (restored === 0) {
    return { ok: false, error: 'Everything this changed has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const ROLE_REF = { type: 'string', description: 'The job_search.roles ref a lookup returned for the role.' } as const;
const APPLICATION_REF = {
  type: 'string',
  description: 'Instead of role_ref: the job_search.applications ref job_applications returned.',
} as const;
const CLEARABLE = 'An empty string clears it.';

export const JOBS_WRITES: readonly JobsWrite[] = [
  {
    name: 'change_role',
    runs: sameAs(
      ['app/jobs/(app)/roles/actions.ts#updateRole', 'lib/jobs/roles/edit.ts#saveRoleEdit'],
      ['app/jobs/(app)/roles/[id]/actions.ts#renameRole', 'lib/jobs/roles/edit.ts#saveRoleEdit'],
      ['app/jobs/(app)/roles/[id]/actions.ts#moveRoleToCompany', 'lib/jobs/roles/edit.ts#saveRoleEdit'],
    ),
    description:
      "Change a role in their Jobs workspace when they ask: its title, what kind of opening it is (a job, or an accelerator, fellowship or grant), location, work mode, seniority, posting link, whether the posting is open, its description, its yearly pay band and where that came from, or the company it is filed under (by name; one not on file is added), or mark its company a target (company_priority). Give only the fields to change. Name the role by role_ref, or application_ref. Moving it to another stage is move_roles.",
    input_schema: {
      type: 'object',
      properties: {
        role_ref: ROLE_REF,
        application_ref: APPLICATION_REF,
        title: { type: 'string', description: 'The new title.' },
        location: { type: 'string', description: `Where the role is, such as "London" or "Remote, US". ${CLEARABLE}` },
        kind: { type: 'string', enum: [...ROLE_KINDS], description: 'What kind of opening it is: job, or accelerator, fellowship, grant or other.' },
        work_mode: { type: 'string', description: `One of ${WORK_MODES.join(', ')}. ${CLEARABLE}` },
        seniority: { type: 'string', description: `Such as "Senior" or "Staff". ${CLEARABLE}` },
        posting_status: { type: 'string', enum: [...POSTING_STATUSES], description: 'Whether the posting is open, closed or unknown.' },
        posting_url: { type: 'string', description: `The link to the posting. ${CLEARABLE}` },
        description: { type: 'string', description: `The job description, in full, as they gave it. ${CLEARABLE}` },
        pay_min: { type: 'number', description: 'The bottom of the yearly pay band, a whole amount such as 150000. 0 clears it.' },
        pay_max: { type: 'number', description: 'The top of the yearly pay band. 0 clears it.' },
        pay_source: { type: 'string', description: `Where the pay came from: ${PAY_SOURCES.join(', ')}. ${CLEARABLE}` },
        company: { type: 'string', description: 'The company the role belongs to, by name.' },
        company_priority: {
          type: 'string',
          enum: [...PRIORITIES],
          description: "How much they want to work at the role's company, such as target. Set on the company, after any move, and kept if this change is undone.",
        },
        fact_source: {
          type: 'string',
          enum: [...FACT_SOURCES],
          description:
            'Where the location, work mode, seniority, posting status and pay given came from: posting when quoted from the posting, email when quoted from an email (give email_ref), person when they told you the value, guess when you worked it out. Left out, they are recorded as your guess, except pay with pay_source posted or recruiter. A guess does not replace a value that came from the posting or an email.',
        },
        email_ref: { type: 'string', description: 'With fact_source email: the ref search_mail or a lookup returned for the email the values came from.' },
      },
      additionalProperties: false,
    },
    run: changeRole,
  },
  {
    name: 'change_application',
    runs: sameAs(
      ['app/jobs/(app)/pipeline/actions.ts#setExcitement', 'lib/jobs/applications/edit.ts#saveApplicationEdit'],
      ['app/jobs/(app)/pipeline/actions.ts#setChannel', 'lib/jobs/applications/edit.ts#saveApplicationEdit'],
      ['app/jobs/(app)/roles/[id]/actions.ts#saveApplicationMarks', 'lib/jobs/applications/edit.ts#saveApplicationEdit'],
    ),
    description:
      'Set how excited they are about a role (1 to 5, or 0 to clear it), how they applied (the channel; for a referral, who referred them by the job_search.contacts ref a lookup returned), whether the application is ready to apply, whether all its questions are added, or whether it has a cover letter, when they ask. Name it by application_ref, or role_ref for the role\'s latest application.',
    input_schema: {
      type: 'object',
      properties: {
        application_ref: { type: 'string', description: 'The job_search.applications ref job_applications returned.' },
        role_ref: { type: 'string', description: "Instead of application_ref: the job_search.roles ref, for the role's latest application." },
        excitement: { type: 'integer', description: 'How excited they are, 1 to 5; 0 clears it.' },
        channel: { type: 'string', enum: [...APPLICATION_SOURCES], description: 'How they applied.' },
        referral_contact_ref: { type: 'string', description: 'With channel referral: the job_search.contacts ref of who referred them.' },
        ready_to_apply: { type: 'boolean', description: 'True when the application is ready to send, false when it is not.' },
        all_questions_added: { type: 'boolean', description: 'True when every question the application asks has been added to it, false when not.' },
        has_cover_letter: {
          type: ['boolean', 'null'],
          description: 'Whether the application has a cover letter: true yes, false no, null clears the answer.',
        },
      },
      additionalProperties: false,
    },
    run: changeApplication,
  },
  {
    name: 'add_application_questions',
    runs: sameAs(['app/jobs/(app)/roles/actions.ts#addQuestions', 'lib/jobs/fingerprint.ts#splitQuestionBlock']),
    description: `Add the questions an application asks to it, when they give them: each goes into their question bank too, or is matched to the same question already there, and one already on the application is left out. Up to ${QUESTIONS_MAX} at a time. Name the application by application_ref, or role_ref for the role's latest one. Answer them with save_answer.`,
    input_schema: {
      type: 'object',
      properties: {
        application_ref: { type: 'string', description: 'The job_search.applications ref job_applications returned.' },
        role_ref: { type: 'string', description: "Instead of application_ref: the job_search.roles ref, for the role's latest application." },
        questions: { type: 'array', items: { type: 'string' }, description: 'The questions, one per entry, in the words the form uses.' },
      },
      required: ['questions'],
      additionalProperties: false,
    },
    run: addApplicationQuestions,
  },
  {
    name: 'save_answer',
    runs: sameAs(
      ['app/jobs/(app)/roles/actions.ts#saveAnswer', 'lib/jobs/answers/edit.ts#saveAnswerEdit'],
      ['app/jobs/(app)/roles/actions.ts#saveDraftedAnswer', 'lib/jobs/answers/edit.ts#saveAnswerEdit'],
    ),
    description:
      "Save their answer to a question on an application, when they ask: its words, and whether it is a draft, approved or submitted. When they ask you to write or rewrite answers, do it in one pass without asking for the words: read the answers and their questions with application_answers (role_ref or application_ref), read their evidence bank with list_rows on job_search.evidence_items and the role's description with open_row on job_search.roles, write each new version, and save each with its own save_answer call in the same reply, passing the ref from application_answers as answer_ref, with the evidence_refs it rests on and any unsupported_claims it makes. Writing rules for a rewrite: plain first-person language in their own voice; shorter than the old version; an answer to \"why this company\" says why the company and why they fit before any story; facts only from the evidence bank, their résumé and the job description, and every claim nothing there backs goes in unsupported_claims. Leave status as draft unless they say otherwise; never mark an answer approved or submitted on your own. Finish by telling them which answers you changed, naming each question. Give only what to change. A single answer can also be named by question with application_ref or role_ref. Nothing is sent to the employer.",
    input_schema: {
      type: 'object',
      properties: {
        answer_ref: { type: 'string', description: 'The job_search.application_answers ref.' },
        question: { type: 'string', description: 'Instead of answer_ref: the question, or words from it, on the application named below.' },
        application_ref: { type: 'string', description: 'With question: the job_search.applications ref.' },
        role_ref: { type: 'string', description: "With question, instead of application_ref: the job_search.roles ref, for the role's latest application." },
        answer: { type: 'string', description: 'The answer, in full, replacing what is there.' },
        status: { type: 'string', enum: [...ANSWER_STATUSES], description: 'draft, approved when they are happy with it, or submitted once it went in.' },
        evidence_refs: { type: 'array', items: { type: 'string' }, description: 'The job_search.evidence_items refs the answer rests on, replacing those kept.' },
        unsupported_claims: { type: 'array', items: { type: 'string' }, description: 'Claims in the answer nothing on file backs, to check before submitting.' },
        considerations: { type: 'array', items: { type: 'string' }, description: 'How to approach the question, in short notes they re-read before submitting.' },
      },
      additionalProperties: false,
    },
    run: saveAnswer,
  },
  {
    name: 'set_default_answer',
    runs: sameAs(
      ['app/jobs/(app)/roles/actions.ts#promoteToCanonical', 'lib/jobs/answers/edit.ts#setCanonicalAnswer'],
    ),
    description:
      "Make an answer the one reused for a question on every application, when they ask, as the role page's Make this my default answer does. Name the question by question_ref (list_rows on job_search.questions), or by answer_ref to reuse that answer's words; answer gives the words instead.",
    input_schema: {
      type: 'object',
      properties: {
        question_ref: { type: 'string', description: 'The job_search.questions ref.' },
        answer_ref: { type: 'string', description: "Instead of question_ref: the job_search.application_answers ref whose question, and words, to use." },
        answer: { type: 'string', description: 'The default answer, in full. Needed with question_ref.' },
      },
      additionalProperties: false,
    },
    run: setDefaultAnswer,
  },
  {
    name: 'change_company',
    runs: sameAs(
      ['app/jobs/(app)/companies/actions.ts#updateCompany', 'lib/jobs/companies/edit.ts#saveCompanyEdit'],
      ['app/jobs/(app)/companies/actions.ts#renameCompany', 'lib/jobs/companies/edit.ts#saveCompanyEdit'],
      ['app/jobs/(app)/roles/[id]/actions.ts#addNote', 'lib/jobs/notes.ts#fileJobNote'],
    ),
    description:
      "Change a company in their Jobs workspace when they ask: its name (its page's address moves with it, and a name another of their companies has is refused), its priority, research notes, the email domains that link mail to it, industry, headquarters, website, careers page or LinkedIn page, or the six answers on its Perspective tab, their own view of a company they want to focus on (the perspective_ fields). Give only the fields to change. To add a note to the company's Notes, give note alone. Name the company by company_ref, or by its name in company. To mark the company of a job already saved as a target, look up the role and pass its company here with priority target.",
    input_schema: {
      type: 'object',
      properties: {
        company_ref: { type: 'string', description: 'The job_search.companies ref a lookup returned for the company.' },
        company: { type: 'string', description: "Instead of company_ref: the company's name as it is on file." },
        note: { type: 'string', description: "A note to add to the company's Notes, in their words. Give it with the company and nothing else." },
        name: { type: 'string', description: 'The new name.' },
        priority: { type: 'string', enum: [...PRIORITIES], description: 'How much they want to work there.' },
        research: { type: 'string', description: `Their research notes on the company, in full, replacing what is there. ${CLEARABLE}` },
        domains: {
          type: 'string',
          description: 'The email domains, such as "acme.com, acme.io", replacing what is there. An empty string clears them.',
        },
        industry: { type: 'string', description: `The industry. ${CLEARABLE}` },
        hq_location: { type: 'string', description: `Where it is headquartered. ${CLEARABLE}` },
        website: { type: 'string', description: `The homepage link. ${CLEARABLE}` },
        careers_url: { type: 'string', description: `The careers page link. ${CLEARABLE}` },
        linkedin_url: { type: 'string', description: `The LinkedIn page link. ${CLEARABLE}` },
        ...Object.fromEntries(
          PERSPECTIVE_QUESTIONS.map((question) => [
            question.column,
            { type: 'string', description: `Perspective, ${question.label}: ${question.prompt} In full, replacing what is there. ${CLEARABLE}` },
          ]),
        ),
      },
      additionalProperties: false,
    },
    run: changeCompany,
  },
  {
    name: 'add_company',
    runs: sameAs(['app/jobs/(app)/companies/actions.ts#addCompany', 'lib/jobs/companies/ensure.ts#ensureCompany']),
    description:
      "Add a company to their Jobs workspace from scratch when they ask, as the companies page's Add company does: by name, with how much they want to work there (priority, interested when they do not say) and any details they gave. A company already on file under that name, domain or job board is refused with its ref; change it with change_company. One company per call. A role at it is add_job_lead, a person there is change_contact.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The company\'s name.' },
        priority: { type: 'string', enum: [...PRIORITIES], description: 'How much they want to work there: target, interested, backup or passed. interested when left out.' },
        website: { type: 'string', description: 'The homepage link. It also links their mail from the company\'s domain.' },
        careers_url: { type: 'string', description: 'The careers page link.' },
        linkedin_url: { type: 'string', description: 'The LinkedIn page link.' },
        industry: { type: 'string', description: 'The industry.' },
        hq_location: { type: 'string', description: 'Where it is headquartered.' },
        research: { type: 'string', description: 'Research notes on the company, such as why it is on their list.' },
        domains: { type: 'string', description: 'Email domains beyond the website\'s, such as "acme.io".' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    run: addCompany,
  },
  {
    name: 'merge_roles',
    runs: sameAs(['app/jobs/(app)/companies/actions.ts#mergeRoles', 'lib/jobs/companies/merge-roles.ts#mergeRolesInto']),
    description: `Fold duplicate roles at one company into the one they keep, when they ask: the same posting filed twice. Everything on the duplicates (applications and their events, rounds, answers, letters, reminders, attachments and todo links) moves onto the role kept, the applications become one, the one furthest along, and the duplicates are taken out. Up to ${MERGE_MAX} at a time. A duplicate with comments in its thread is refused.`,
    input_schema: {
      type: 'object',
      properties: {
        keep_role_ref: { type: 'string', description: 'The job_search.roles ref of the role to keep.' },
        merge_role_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'The job_search.roles refs of the duplicates to fold into it, at the same company.',
        },
      },
      required: ['keep_role_ref', 'merge_role_refs'],
      additionalProperties: false,
    },
    run: mergeRoles,
  },
  {
    name: 'change_reminder',
    runs: sameAs(
      ['app/jobs/(app)/_home/actions.ts#completeReminder', 'lib/jobs/today/reminders.ts#saveReminderEdit'],
      ['app/jobs/(app)/_home/actions.ts#snoozeReminder', 'lib/jobs/today/reminders.ts#saveReminderEdit'],
      ['app/jobs/(app)/roles/[id]/timeline-actions.ts#updateReminder', 'lib/jobs/today/reminders.ts#saveReminderEdit'],
      ['app/jobs/(app)/roles/[id]/timeline-actions.ts#linkReminderMessage', 'lib/jobs/today/reminders.ts#saveReminderEdit'],
    ),
    description: `Change a Jobs reminder (a to-do or follow-up on a role) when they ask: finish it, put it off to a day as Jobs Today's Later does, reword it, move it to another day, or link it to the email that asked for it (or unlink it). Find it with list_rows on job_search.reminders. Give only what to change.`,
    input_schema: {
      type: 'object',
      properties: {
        reminder_ref: { type: 'string', description: 'The job_search.reminders ref list_rows or a lookup returned.' },
        finish: { type: 'boolean', description: 'True to tick it off.' },
        put_off: { type: 'string', description: `To put it off, the day it comes back: ${LATER_UNTIL_HELP}.` },
        body: { type: 'string', description: 'The new wording.' },
        due: { type: 'string', description: 'The new due day, YYYY-MM-DD.' },
        email_ref: {
          type: 'string',
          description: 'The email to link it to: the ref search_mail returned, or a job_search.inbox_messages ref. An empty string unlinks it.',
        },
      },
      required: ['reminder_ref'],
      additionalProperties: false,
    },
    run: changeReminder,
  },
  {
    name: 'change_waiting',
    runs: sameAs(
      ['app/jobs/(app)/_home/actions.ts#completeWaiting', 'lib/jobs/today/waiting.ts#setWaitingDismissal'],
      ['app/jobs/(app)/_home/actions.ts#snoozeWaiting', 'lib/jobs/today/waiting.ts#setWaitingDismissal'],
    ),
    description: `Finish or put off to a day a row under "Waiting on you" on Jobs Today, when they ask: an email on a role that asked them for something. Name it by the job_search.application_events ref of that email's event, which list_rows on job_search.application_events returns.`,
    input_schema: {
      type: 'object',
      properties: {
        event_ref: { type: 'string', description: 'The job_search.application_events ref of the request.' },
        verb: { type: 'string', enum: ['finish', 'put_off'], description: 'finish when it is dealt with; put_off for later.' },
        until: { type: 'string', description: `For put_off, the day it comes back: ${LATER_UNTIL_HELP}.` },
      },
      required: ['event_ref', 'verb'],
      additionalProperties: false,
    },
    run: changeWaiting,
  },
  {
    name: 'change_role_email',
    runs: sameAs(
      ['app/jobs/(app)/review/actions.ts#linkMessage', 'lib/jobs/inbox/role-mail.ts#linkMessageToApplication'],
      ['app/jobs/(app)/roles/[id]/mail-actions.ts#unlinkMessage', 'lib/jobs/inbox/role-mail.ts#unlinkMessageFromApplication'],
      ['app/jobs/(app)/roles/[id]/mail-actions.ts#linkCandidateMessage', 'lib/jobs/inbox/role-mail.ts#linkMessageToApplication'],
      ['app/jobs/(app)/roles/[id]/mail-actions.ts#declineCandidateMessage', 'lib/jobs/inbox/role-mail.ts#declineMessageForApplication'],
    ),
    description:
      "Link an email to a role, turn a suggested email down, or take an email off a role it was wrongly linked to, when they ask. link files the email on the role's timeline as the review queue does (an email linked to another role must be unlinked first); decline remembers that the email is not this role's, so it is not suggested again, and leaves the email alone; unlink takes the email and the events it wrote off the role and returns it to the review queue. Name the role by application_ref or role_ref and the email by email_ref.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['link', 'decline', 'unlink'], description: 'link, decline (not this one) or unlink.' },
        application_ref: APPLICATION_REF,
        role_ref: { type: 'string', description: "Instead of application_ref: the job_search.roles ref, for the role's latest application." },
        email_ref: {
          type: 'string',
          description: 'The email: the ref search_mail returned, or a job_search.inbox_messages ref.',
        },
      },
      required: ['action', 'email_ref'],
      additionalProperties: false,
    },
    run: changeRoleEmail,
  },
  {
    name: 'review_application',
    runs: sameAs(
      ['app/jobs/(app)/review/actions.ts#confirmApplication', 'lib/jobs/review/verdicts.ts#confirmApplicationRow'],
      ['app/jobs/(app)/review/actions.ts#reopenApplication', 'lib/jobs/review/verdicts.ts#reopenApplicationRows'],
    ),
    description:
      'Work an application in Jobs review when they ask: confirm one the inbox found as a real pursuit, or reopen a closed one (rejected, withdrawn or gone quiet) as in process or final round, as when a recruiter comes back. Name it by application_ref, or role_ref for the role\'s latest application.',
    input_schema: {
      type: 'object',
      properties: {
        application_ref: { type: 'string', description: 'The job_search.applications ref job_applications returned.' },
        role_ref: { type: 'string', description: "Instead of application_ref: the job_search.roles ref, for the role's latest application." },
        verb: { type: 'string', enum: ['confirm', 'reopen'], description: 'confirm a pursuit the inbox found; reopen a closed one.' },
        status: { type: 'string', enum: [...REOPEN_STATUSES], description: 'With reopen: the stage it goes back to.' },
      },
      required: ['verb'],
      additionalProperties: false,
    },
    run: reviewApplication,
  },
  {
    name: 'review_events',
    runs: sameAs(
      ['app/jobs/(app)/review/actions.ts#acknowledgeEvent', 'lib/jobs/review/verdicts.ts#acknowledgeEventRows'],
      ['app/jobs/(app)/review/actions.ts#acknowledgeEvents', 'lib/jobs/review/verdicts.ts#acknowledgeEventRows'],
      ['app/jobs/(app)/review/actions.ts#unacknowledgeEvents', 'lib/jobs/review/verdicts.ts#unacknowledgeEventRows'],
    ),
    description: `Acknowledge events flagged in Jobs review when they ask (mail that conflicts with where a pursuit stands, such as an invite after a rejection): each stays on the timeline and the flag clears. take_back flags them again. Up to ${EVENTS_MAX} at a time, named by their job_search.application_events refs, which list_rows on job_search.application_events returns.`,
    input_schema: {
      type: 'object',
      properties: {
        event_refs: { type: 'array', items: { type: 'string' }, description: 'The job_search.application_events refs.' },
        verb: { type: 'string', enum: ['acknowledge', 'take_back'], description: 'acknowledge to clear the flags; take_back to flag them again.' },
      },
      required: ['event_refs', 'verb'],
      additionalProperties: false,
    },
    run: reviewEvents,
  },
  {
    name: 'review_emails',
    runs: sameAs(
      ['app/jobs/(app)/review/actions.ts#dismissMessage', 'lib/jobs/review/verdicts.ts#dismissMessageRows'],
      ['app/jobs/(app)/review/actions.ts#dismissMessages', 'lib/jobs/review/verdicts.ts#dismissMessageRows'],
      ['app/jobs/(app)/review/actions.ts#restoreDismissedMessages', 'lib/jobs/review/verdicts.ts#restoreMessageRow'],
    ),
    description: `Dismiss emails waiting in Jobs review when they ask (mail that is not about their job search): each is marked not relevant and leaves the queue. restore brings a dismissed one back to the queue, with the classification it has unless classification gives the right one. Up to ${EMAILS_MAX} at a time, named by the refs search_mail returned or their job_search.inbox_messages refs. Linking an email to a role is change_role_email.`,
    input_schema: {
      type: 'object',
      properties: {
        email_refs: { type: 'array', items: { type: 'string' }, description: 'The emails: refs from search_mail, or job_search.inbox_messages refs.' },
        verb: { type: 'string', enum: ['dismiss', 'restore'], description: 'dismiss to take them out of the queue; restore to bring dismissed ones back.' },
        classification: {
          type: 'string',
          enum: CLASSIFICATIONS.filter((c) => c !== 'not_relevant'),
          description: 'With restore, when they say what the email is: the kind it comes back as.',
        },
      },
      required: ['email_refs', 'verb'],
      additionalProperties: false,
    },
    run: reviewEmails,
  },
  {
    name: 'change_contact',
    runs: sameAs(
      ['app/jobs/(app)/contacts/actions.ts#createContact', 'lib/jobs/contacts/edit.ts#addContact'],
      ['app/jobs/(app)/contacts/actions.ts#updateContact', 'lib/jobs/contacts/edit.ts#saveContactEdit'],
    ),
    description:
      "Add a contact to their job search, or correct one, when they ask: name, title, company (by name; one not on file is added), LinkedIn page, work email, how they know them (relationship, and how_we_connect in their words), notes, and whether they are a potential lead. An agent that finds people for them marks each one found_by_dash, marks it potential_lead when it could lead to a job, and says in notes why it picked them. Leave contact_ref out to add one; give it, with only the fields to change, to correct one. There is no field for a personal phone number or home address, and none is kept.",
    input_schema: {
      type: 'object',
      properties: {
        contact_ref: { type: 'string', description: 'The job_search.contacts ref a lookup returned, to correct that contact. Leave it out to add one.' },
        full_name: { type: 'string', description: 'Their name. Needed to add one.' },
        title: { type: 'string', description: `Their job title. ${CLEARABLE}` },
        company: { type: 'string', description: `The company they work at, by name. ${CLEARABLE}` },
        linkedin_url: { type: 'string', description: `Their LinkedIn page. ${CLEARABLE}` },
        email: { type: 'string', description: `Their work email. ${CLEARABLE}` },
        relationship: { type: 'string', enum: [...RELATIONSHIPS], description: 'How they know them; cold when they do not.' },
        how_we_connect: { type: 'string', description: `How they know them, in their words. ${CLEARABLE}` },
        notes: { type: 'string', description: `Notes on them, in full, replacing what is there. ${CLEARABLE}` },
        potential_lead: { type: 'boolean', description: 'True when they could lead to a job: someone worth reaching out to, which the Contacts page filters on. False to take the mark off.' },
        found_by_dash: { type: 'boolean', description: 'True when Dash or an agent found this person rather than them adding someone they know. The Contacts page filters on it.' },
      },
      additionalProperties: false,
    },
    run: changeContact,
  },
  {
    name: 'change_touch',
    runs: sameAs(
      ['app/jobs/(app)/contacts/actions.ts#logTouch', 'lib/jobs/contacts/edit.ts#addTouch'],
      ['app/jobs/(app)/contacts/actions.ts#updateTouch', 'lib/jobs/contacts/edit.ts#saveTouchEdit'],
      ['app/jobs/(app)/follow-ups/actions.ts#saveFollowUpNote', 'lib/jobs/contacts/edit.ts#saveTouchEdit'],
      ['app/jobs/(app)/contacts/actions.ts#markTouchSent', 'lib/jobs/contacts/edit.ts#markDraftSent'],
      ['app/jobs/(app)/contacts/actions.ts#markTouchAnswered', 'lib/jobs/contacts/edit.ts#answerTouch'],
    ),
    description:
      "Keep the outreach log on a contact when they ask: log that they reached out to someone or heard from them (log; a message they sent moves the contact from to-contact to contacted; with draft true it is kept as a draft and moves nothing), correct a logged touch's channel or words (edit), mark a draft sent now (sent), or mark one answered with what came back (answered; the contact moves to responded). This records what they did; nothing is sent. Touches are listed by list_rows on job_search.contact_touches.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['log', 'edit', 'sent', 'answered'], description: 'log a new touch, edit one, mark a draft sent, or mark one answered.' },
        contact_ref: { type: 'string', description: 'With log: the job_search.contacts ref of who it was with.' },
        touch_ref: { type: 'string', description: 'With edit, sent or answered: the job_search.contact_touches ref.' },
        draft: { type: 'boolean', description: 'With log, optionally: true keeps it as a draft, written but not sent.' },
        channel: { type: 'string', enum: [...TOUCH_CHANNELS], description: 'How it went: a LinkedIn message or connection request, email, an introduction, an event, or other.' },
        direction: { type: 'string', enum: [...DIRECTIONS], description: 'With log: outbound when they reached out (the default), inbound when the contact did.' },
        message: { type: 'string', description: `What was said. With edit, ${CLEARABLE.toLowerCase()}` },
        application_ref: { type: 'string', description: 'With log, optionally: the job_search.applications ref it was about.' },
        response: { type: 'string', description: 'With answered: what came back, in a line.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: changeTouch,
  },
  {
    name: 'mark_suggestion_sent',
    runs: sameAs(
      ['app/jobs/(app)/find/recommend-actions.ts#markSuggestionSent', 'lib/jobs/contacts/edit.ts#addTouch'],
    ),
    description:
      "Mark a person Dash suggested on Find as messaged, when they say they sent it, as Find's Sent press does: they are added as a contact if they are not one, the suggested message is logged as sent in the outreach log, and the suggestion is closed. Nothing is sent from here. Name it by suggestion_ref, or by person for who it suggested (a name or words from its line); an unclear name is refused with the open ones listed.",
    input_schema: {
      type: 'object',
      properties: {
        suggestion_ref: { type: 'string', description: 'The job_search.suggestions ref of the suggestion.' },
        person: { type: 'string', description: 'Instead of suggestion_ref: the name of the person it suggested, or words from its line.' },
      },
      additionalProperties: false,
    },
    run: markSuggestionSent,
  },
  {
    name: 'add_role_from_email',
    runs: sameAs(
      ['app/jobs/(app)/review/actions.ts#createRoleFromMessage', 'lib/jobs/inbox/role-mail.ts#addPursuitFromMail'],
    ),
    description:
      "Make a new role from an email in Jobs review when they say it is about a pursuit with nothing on file, as the review page's new role option does: the company (found by name, or added), the role and its application are made, and the email is linked to it, filing the event its classification implies, such as a rejection or an interview invite. Refused when the company already has a role of that title; link the email to a role on file with change_role_email.",
    input_schema: {
      type: 'object',
      properties: {
        email_ref: { type: 'string', description: 'The email: the ref search_mail returned, or a job_search.inbox_messages ref.' },
        company: { type: 'string', description: 'The company the role is at, by name.' },
        title: { type: 'string', description: 'What the role is called.' },
      },
      required: ['email_ref', 'company', 'title'],
      additionalProperties: false,
    },
    run: addRoleFromEmail,
  },
  // From Material, Settings and Find (plan #1894.6.7), in lib/dash/career-writes.ts.
  ...CAREER_WRITES,
  // A role's interviews, interviewers and rounds (plan #1894.6.9), in lib/dash/interview-edit-writes.ts.
  ...INTERVIEW_EDIT_WRITES,
];

/** Runs one Jobs write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runJobsWrite(
  write: JobsWrite,
  env: JobsWriteEnv,
  input: unknown,
): Promise<JobsMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof JobsRefused) return { ok: false, error: error.message };
    console.error(`jobs write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

/** The clients a Jobs write runs on, from a surface's clients per schema. */
export async function jobsEnv(userId: string, db: AskDb, timezone?: string): Promise<JobsWriteEnv> {
  return { userId, jobs: await db('job_search'), todo: await db('todo'), core: await db('core'), timezone };
}

/** The sentence for a person with Jobs switched off. */
export const JOBS_OFF = 'The Jobs workspace is switched off, so nothing can be changed there.';

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Jobs writes as Ask's write tools, run on the person's own clients. */
export const JOBS_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = JOBS_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('jobs')) return { ok: false, error: JOBS_OFF };
    const made = await runJobsWrite(write, await jobsEnv(ctx.userId, ctx.db, ctx.timezone), input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown> };
  },
}));

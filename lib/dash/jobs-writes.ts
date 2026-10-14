import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskDb, type AskRow, type AskSchema, type SchemaClient } from '@/lib/ask/db';
import type { JobsChangeInput, JobsChangeKind } from '@/lib/ask/jobs-changes';
import { toRef } from '@/lib/core/refs';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { extractCompBand, extractRequirements, jdHash } from '@/lib/jobs/jd/requirements';
import { APPLICATION_SOURCES, SOURCE_LABELS, statusRank, TERMINAL_STATUSES, type ApplicationSource, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { slugify } from '@/lib/jobs/slug';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The Jobs changes an agent makes when asked (plan #1894.6.1, feature
 * #1894.6), the ones the role page and the pipeline let the person make by
 * hand:
 *
 *   change_role         a role's title, location, work mode, seniority,
 *                       posting link and status, description or pay band,
 *                       or the company it is filed under.
 *   change_application  how excited they are about it, and how they applied
 *                       (the channel, and who referred them).
 *
 * and, from the company page (plan #1894.6.2):
 *
 *   change_company      a company's name, priority, research notes, domains,
 *                       industry, headquarters and links.
 *   merge_roles         fold duplicate roles at one company into the one
 *                       they keep.
 *
 * and, from Jobs Today and a role's timeline (plan #1894.6.3):
 *
 *   change_reminder     a reminder finished, put off a week, reworded, moved
 *                       to another day, or linked to the email behind it.
 *   change_waiting      a "Waiting on you" row done or put off a week.
 *
 * and, from Jobs review (plan #1894.6.4.1):
 *
 *   review_application  an application the inbox found confirmed, or a
 *                       closed one reopened by hand.
 *   review_events       flagged events acknowledged, or flagged again.
 *
 * Moving a role to another stage is move_roles (lib/dash/bulk-roles.ts), and
 * removing a pursuit deletes rows, which Dash never does.
 *
 * All but the merge and the review changes name one row as their subject
 * and update it, so the one undo rule in lib/core/dash-actions.ts puts it back from the values kept
 * (#1894.4: an agent's writes go straight in, each listed on Home with an
 * Undo). A role moved to a company that was not on file yet makes that
 * company, as the page's move does; the Undo puts the role back and leaves
 * the company, which then holds nothing.
 *
 * A merge touches many rows: it moves everything on the duplicate roles and
 * their applications onto the one kept, and takes the duplicates out. Its
 * record keeps every row it moved and every row it took out, whole, in
 * `undo` (MergeUndo), and undoRoleMerge puts them all back
 * (MANY_ROW_KINDS in lib/core/dash-actions.ts sends its Undo there). The
 * review changes keep their rows the same way, as RowsUndo, for
 * undoJobsRows.
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
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: JobsWriteEnv, args: Args) => Promise<JobsMade>;
};

/** A refusal the model reads and says in words. */
export class JobsRefused extends Error {}

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
  if (!isUuid(value)) throw new JobsRefused(`That is not a ${what}'s ref, as a lookup returned it.`);
  return value;
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
    // As the role page saves a pasted description: its hash, its source, the
    // requirements read from it, and the pay band when it names one and this
    // call sets none by hand.
    const description = clearable(args, 'description', DESCRIPTION_MAX);
    update.jd_text = description;
    update.jd_hash = description ? jdHash(description) : null;
    update.jd_source = description ? 'manual' : null;
    update.jd_lookup_note = null;
    update.requirements = description ? extractRequirements(description) : null;
    update.requirements_extracted_at = description ? new Date().toISOString() : null;
    if (description && !given(args, 'pay_min') && !given(args, 'pay_max')) {
      const band = extractCompBand(description);
      if (band) {
        update.comp_min_cents = band.minCents;
        update.comp_max_cents = band.maxCents;
        update.comp_source = 'posted';
      }
    }
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

  if (Object.keys(update).length === 0) {
    throw new JobsRefused('Nothing to change: give at least one field with its new value.');
  }

  const { data, error } = await env.jobs
    .from('roles')
    .update(update)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (error?.code === '23505') {
    throw new JobsRefused('That company already has this same posting. The two can be merged from the company page.');
  }
  if (error || !data) throw new Error(`Changing the role failed: ${error?.message ?? 'no row'}`);

  const after = data as Row;
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
  const update: Row = {};
  const changed: string[] = [];

  if (given(args, 'excitement')) {
    const value = args.excitement === 0 ? null : args.excitement;
    if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)) {
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
    update.source = channel;
    update.referral_contact_id = referral;
    changed.push(`set how they applied to ${SOURCE_LABELS[channel]}`);
  } else if (given(args, 'referral_contact_ref')) {
    throw new JobsRefused('referral_contact_ref goes with channel "referral".');
  }

  if (Object.keys(update).length === 0) throw new JobsRefused('Nothing to change: give excitement or channel.');

  const { data, error } = await env.jobs
    .from('applications')
    .update(update)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Changing the application failed: ${error?.message ?? 'no row'}`);

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
// change_company
// ---------------------------------------------------------------------------

const COMPANIES = 'job_search.companies';
const PRIORITIES = ['target', 'interested', 'backup', 'passed'] as const;
const COMPANY_NAME_MAX = 120;
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
  return [
    ...new Set(
      (entries ?? [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
        .filter((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(entry)),
    ),
  ];
}

/** The fields change_company sets, by argument, with the column and the words for each. */
const COMPANY_FIELDS = [
  { arg: 'research', column: 'research', said: 'the research notes', max: RESEARCH_MAX },
  { arg: 'industry', column: 'industry', said: 'the industry', max: FIELD_MAX },
  { arg: 'hq_location', column: 'hq_location', said: 'the headquarters', max: FIELD_MAX },
  { arg: 'website', column: 'website', said: 'the website', max: LINK_MAX },
  { arg: 'careers_url', column: 'careers_url', said: 'the careers page', max: LINK_MAX },
  { arg: 'linkedin_url', column: 'linkedin_url', said: 'the LinkedIn page', max: LINK_MAX },
] as const;

async function changeCompany(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await namedCompany(env, args);
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
    const slug = slugify(name);
    const { data: clash, error } = await env.jobs
      .from('companies')
      .select('id, name')
      .eq('user_id', env.userId)
      .eq('slug', slug)
      .neq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Checking the name failed: ${error.message}`);
    if (clash) throw new JobsRefused(`They already have a company called ${(clash as Row).name as string}.`);
    if (name !== before.name) {
      update.name = name;
      update.slug = slug;
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
  }
  if (given(args, 'domains')) {
    update.domains = domainsOf(args.domains);
    changed.push('the domains');
  }

  if (Object.keys(update).length === 0) throw new JobsRefused('Nothing to change: give at least one field with its new value.');

  const { data, error } = await env.jobs
    .from('companies')
    .update(update)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
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

// ---------------------------------------------------------------------------
// merge_roles
// ---------------------------------------------------------------------------

/**
 * The rows that hang off an application, by `schema.table`, with the column
 * that names it, whether the table keeps a user_id, and the columns that,
 * with the application, may hold only one row. Every one is moved onto the
 * application kept, so nothing goes with the duplicates. The company page's
 * own merge moves fewer, and its reminders, rounds groups and quiet marks go
 * with the row it deletes.
 */
const APPLICATION_CHILDREN = [
  { table: 'job_search.application_events', column: 'application_id', owned: true, unique: null },
  { table: 'job_search.application_answers', column: 'application_id', owned: true, unique: 'question_id' },
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

/** The rows that hang off a role itself, moved onto the role kept. Its applications are handled on their own. */
const ROLE_CHILDREN = [
  { table: 'job_search.attachments', column: 'role_id', owned: true },
  { table: 'job_search.suggestions', column: 'role_id', owned: true },
  { table: 'todo.task_links', column: 'role_id', owned: false },
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

/** The applications the page counts furthest along win; between two as far along, the older. */
function keptApplication(apps: Row[]): Row {
  return apps.reduce((best, app) => {
    const appRank = statusRank(app.status as ApplicationStatus);
    const bestRank = statusRank(best.status as ApplicationStatus);
    if (appRank !== bestRank) return appRank > bestRank ? app : best;
    return new Date(app.created_at as string) < new Date(best.created_at as string) ? app : best;
  });
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

/** A role's thread stays under the role's own ref, so a merge would leave it behind: refused. */
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
        `${names.get(role.id as string)} has comments in its thread, which a merge would leave behind. Ask them to keep that role instead, or to merge on the company page.`,
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
  const target = apps.length > 0 ? keptApplication(apps) : null;
  const losers = apps.filter((app) => app.id !== target?.id);
  const loserIds = losers.map((app) => app.id as string);

  await refuseThreads(env, merged, loserIds, names);

  const undo: MergeUndo = { roles_removed: [], updated: [], applications_removed: [], moved: [], removed: [] };
  try {
    if (target) {
      const targetId = target.id as string;
      for (const child of APPLICATION_CHILDREN) {
        const rows = await rowsWhere(env, child.table, child.column, loserIds, child.owned);
        if (rows.length === 0) continue;
        const theirs = child.unique ? await rowsWhere(env, child.table, child.column, [targetId], child.owned) : [];
        const taken = new Set(theirs.map((row) => row[child.unique as string]).filter((value) => value !== null && value !== undefined));
        const { client, name } = schemaOf(env, child.table);
        for (const row of rows) {
          const key = child.unique ? row[child.unique] : null;
          if (child.unique && key !== null && key !== undefined && taken.has(key)) {
            // The application kept already has its twin: this one is kept whole for the Undo and taken out.
            const { error } = await client.from(name).delete().eq('id', row.id as string);
            if (error) throw new Error(`${child.table}: ${error.message}`);
            undo.removed.push({ table: child.table, values: row });
            continue;
          }
          const { error } = await client
            .from(name)
            .update({ [child.column]: targetId })
            .eq('id', row.id as string)
            .eq(child.column, row[child.column] as string);
          if (error) throw new Error(`${child.table}: ${error.message}`);
          undo.moved.push({ table: child.table, id: row.id as string, column: child.column, from: row[child.column] as string, to: targetId });
          if (key !== null && key !== undefined && child.unique) taken.add(key);
        }
      }

      for (const loser of losers) {
        const { error } = await env.jobs.from('applications').delete().eq('id', loser.id as string).eq('user_id', env.userId);
        if (error) throw new Error(`applications: ${error.message}`);
        undo.applications_removed.push(loser);
      }

      // As the page merges: a status set by hand on a duplicate is a decision
      // of theirs, kept when the application kept has none, and the one kept
      // becomes the first attempt at the role kept.
      const change: Row = {};
      const override = losers.find((app) => app.status_manual_override)?.status_manual_override;
      if (!target.status_manual_override && override) change.status_manual_override = override;
      if (target.role_id !== keepId || target.attempt !== 1) {
        change.role_id = keepId;
        change.attempt = 1;
      }
      if (Object.keys(change).length > 0) {
        const { error } = await env.jobs.from('applications').update(change).eq('id', targetId).eq('user_id', env.userId);
        if (error) throw new Error(`applications: ${error.message}`);
        const was = Object.fromEntries(Object.keys(change).map((column) => [column, target[column] ?? null]));
        undo.updated.push({ table: APPLICATIONS, id: targetId, before: was, after: change });
      }
    }

    for (const child of ROLE_CHILDREN) {
      const rows = await rowsWhere(env, child.table, child.column, mergedIds, child.owned);
      const { client, name } = schemaOf(env, child.table);
      for (const row of rows) {
        const { error } = await client
          .from(name)
          .update({ [child.column]: keepId })
          .eq('id', row.id as string)
          .eq(child.column, row[child.column] as string);
        if (error) throw new Error(`${child.table}: ${error.message}`);
        undo.moved.push({ table: child.table, id: row.id as string, column: child.column, from: row[child.column] as string, to: keepId });
      }
    }

    for (const role of merged) {
      const { error } = await env.jobs.from('roles').delete().eq('id', role.id as string).eq('user_id', env.userId);
      if (error) throw new Error(`roles: ${error.message}`);
      undo.roles_removed.push(role);
    }
  } catch (error) {
    // Put back whatever went before the failure, so a merge is whole or not at all.
    await putBackMerge({ userId: env.userId, db: async (schema) => (schema === 'todo' ? env.todo : env.jobs) }, undo).catch(
      (failed: unknown) => console.error('merge_roles: putting a failed merge back failed', failed),
    );
    throw error;
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
const DAY_MS = 24 * 60 * 60 * 1000;

/** A week on, as Jobs Today's "Later" puts a reminder or a waiting row off. */
const putOffUntil = () => new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString();

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
  let query = env.jobs.from('inbox_messages').select('id, subject').eq('user_id', env.userId);
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
  const update: Row = {};
  const changed: string[] = [];

  if (args.finish === true && args.put_off === true) throw new JobsRefused('Finish it or put it off, not both.');
  if (args.finish === true) {
    if (before.completed_at) throw new JobsRefused('That reminder is finished already.');
    update.completed_at = new Date().toISOString();
    changed.push('finished');
  }
  if (args.put_off === true) {
    if (given(args, 'due')) throw new JobsRefused('Put it off a week, or give it a new due date, not both.');
    update.due_at = putOffUntil();
    changed.push(`put off for ${SNOOZE_DAYS} days`);
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
      update.ingested_message_id = email.id;
      changed.push(`linked to the email ${quotedBody(email.subject, 'with no subject')}`);
    }
  }

  if (Object.keys(update).length === 0) {
    throw new JobsRefused('Nothing to change: give finish, put_off, body, due or email_ref.');
  }

  const { data, error } = await env.jobs
    .from('reminders')
    .update(update)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Changing the reminder failed: ${error?.message ?? 'no row'}`);

  const after = data as Row;
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
 * page does: no date for done, a week on for later. The first time that row
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

  const until = verb === 'finish' ? null : putOffUntil();
  const { data, error } = before
    ? await env.jobs
        .from('waiting_dismissals')
        .update({ dismissed_until: until })
        .eq('id', before.id as string)
        .eq('user_id', env.userId)
        .select('*')
        .single()
    : await env.jobs
        .from('waiting_dismissals')
        .insert({ user_id: env.userId, application_event_id: eventId, dismissed_until: until })
        .select('*')
        .single();
  if (error || !data) throw new Error(`Changing the waiting row failed: ${error?.message ?? 'no row'}`);

  const after = data as Row;
  const role = await applicationRole(env, event.application_id);
  const what = quotedBody(event.summary, 'the email that asked them something');
  const said = verb === 'finish' ? 'marked done' : `put off for ${SNOOZE_DAYS} days`;
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

/** The tables a review change's undo may name. Every one keeps a user_id. */
const ROWS_TABLES = new Set([APPLICATIONS, 'job_search.application_events']);

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
    const { error } = await env.jobs.from('applications').update({ needs_review: false }).eq('id', id).eq('user_id', env.userId);
    if (error) throw new Error(`Confirming the application failed: ${error.message}`);
    undo.updated.push({ table: APPLICATIONS, id, before: { needs_review: true }, after: { needs_review: false } });
  } else {
    const status = oneOf(args, 'status', REOPEN_STATUSES, false) as (typeof REOPEN_STATUSES)[number];
    if (!TERMINAL_STATUSES.includes(before.status as ApplicationStatus)) {
      throw new JobsRefused('That pursuit is not closed, so there is nothing to reopen. Moving it to another stage is move_roles.');
    }
    label = status.replace(/_/g, ' ');
    // As the page reopens one: the event says so on the timeline, and the override sets the stage.
    const { data: event, error: eventError } = await env.jobs
      .from('application_events')
      .insert({
        user_id: env.userId,
        application_id: id,
        kind: 'status_override',
        occurred_at: new Date().toISOString(),
        source: 'manual',
        summary: `Reopened by hand as ${label}`,
        payload: { status },
      })
      .select('id')
      .single();
    if (eventError || !event) throw new Error(`Recording the reopen failed: ${eventError?.message ?? 'no row'}`);
    undo.inserted.push({ table: 'job_search.application_events', id: (event as Row).id as string });
    const { error } = await env.jobs.from('applications').update({ status_manual_override: status }).eq('id', id).eq('user_id', env.userId);
    if (error) {
      await env.jobs.from('application_events').delete().eq('id', (event as Row).id as string).eq('user_id', env.userId);
      throw new Error(`Reopening the application failed: ${error.message}`);
    }
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
  const set = verb === 'acknowledge' ? { needs_review: false, acknowledged_at: new Date().toISOString() } : { needs_review: true, acknowledged_at: null };
  const { data: written, error } = await env.jobs
    .from('application_events')
    .update(set)
    .in('id', changed)
    .eq('user_id', env.userId)
    .select('*');
  if (error) throw new Error(`Changing the events failed: ${error.message}`);
  const afterById = new Map(((written ?? []) as Row[]).map((row) => [row.id as string, row]));

  // Matched on acknowledged_at alone: the sync trigger may re-derive the flag, and the stamp is what this wrote.
  const undo: RowsUndo = {
    updated: events.map((row) => ({
      table: 'job_search.application_events',
      id: row.id as string,
      before: { needs_review: row.needs_review, acknowledged_at: row.acknowledged_at ?? null },
      after: { acknowledged_at: afterById.get(row.id as string)?.acknowledged_at ?? set.acknowledged_at },
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
    let query = jobs.from(name(row.table)).update(row.before).eq('id', row.id).eq('user_id', deps.userId);
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
    description:
      "Change a role in their Jobs workspace when they ask: its title, location, work mode, seniority, posting link, whether the posting is open, its description, its yearly pay band and where that came from, or the company it is filed under (by name; one not on file is added). Give only the fields to change. Name the role by role_ref, or application_ref. Moving it to another stage is move_roles.",
    input_schema: {
      type: 'object',
      properties: {
        role_ref: ROLE_REF,
        application_ref: APPLICATION_REF,
        title: { type: 'string', description: 'The new title.' },
        location: { type: 'string', description: `Where the role is, such as "London" or "Remote, US". ${CLEARABLE}` },
        work_mode: { type: 'string', description: `One of ${WORK_MODES.join(', ')}. ${CLEARABLE}` },
        seniority: { type: 'string', description: `Such as "Senior" or "Staff". ${CLEARABLE}` },
        posting_status: { type: 'string', enum: [...POSTING_STATUSES], description: 'Whether the posting is open, closed or unknown.' },
        posting_url: { type: 'string', description: `The link to the posting. ${CLEARABLE}` },
        description: { type: 'string', description: `The job description, in full, as they gave it. ${CLEARABLE}` },
        pay_min: { type: 'number', description: 'The bottom of the yearly pay band, a whole amount such as 150000. 0 clears it.' },
        pay_max: { type: 'number', description: 'The top of the yearly pay band. 0 clears it.' },
        pay_source: { type: 'string', description: `Where the pay came from: ${PAY_SOURCES.join(', ')}. ${CLEARABLE}` },
        company: { type: 'string', description: 'The company the role belongs to, by name.' },
      },
      additionalProperties: false,
    },
    run: changeRole,
  },
  {
    name: 'change_application',
    description:
      'Set how excited they are about a role (1 to 5, or 0 to clear it) or how they applied (the channel; for a referral, who referred them by the job_search.contacts ref a lookup returned), when they ask. Name it by application_ref, or role_ref for the role\'s latest application.',
    input_schema: {
      type: 'object',
      properties: {
        application_ref: { type: 'string', description: 'The job_search.applications ref job_applications returned.' },
        role_ref: { type: 'string', description: "Instead of application_ref: the job_search.roles ref, for the role's latest application." },
        excitement: { type: 'integer', description: 'How excited they are, 1 to 5; 0 clears it.' },
        channel: { type: 'string', enum: [...APPLICATION_SOURCES], description: 'How they applied.' },
        referral_contact_ref: { type: 'string', description: 'With channel referral: the job_search.contacts ref of who referred them.' },
      },
      additionalProperties: false,
    },
    run: changeApplication,
  },
  {
    name: 'change_company',
    description:
      "Change a company in their Jobs workspace when they ask: its name (its page's address moves with it, and a name another of their companies has is refused), its priority, research notes, the email domains that link mail to it, industry, headquarters, website, careers page or LinkedIn page. Give only the fields to change. Name the company by company_ref, or by its name in company.",
    input_schema: {
      type: 'object',
      properties: {
        company_ref: { type: 'string', description: 'The job_search.companies ref a lookup returned for the company.' },
        company: { type: 'string', description: "Instead of company_ref: the company's name as it is on file." },
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
      },
      additionalProperties: false,
    },
    run: changeCompany,
  },
  {
    name: 'merge_roles',
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
    description: `Change a Jobs reminder (a to-do or follow-up on a role) when they ask: finish it, put it off ${SNOOZE_DAYS} days as Jobs Today's Later does, reword it, move it to another day, or link it to the email that asked for it (or unlink it). Find it with list_rows on job_search.reminders. Give only what to change.`,
    input_schema: {
      type: 'object',
      properties: {
        reminder_ref: { type: 'string', description: 'The job_search.reminders ref list_rows or a lookup returned.' },
        finish: { type: 'boolean', description: 'True to tick it off.' },
        put_off: { type: 'boolean', description: `True to put it off ${SNOOZE_DAYS} days from now.` },
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
    description: `Finish or put off (${SNOOZE_DAYS} days) a row under "Waiting on you" on Jobs Today, when they ask: an email on a role that asked them for something. Name it by the job_search.application_events ref of that email's event, which list_rows on job_search.application_events returns.`,
    input_schema: {
      type: 'object',
      properties: {
        event_ref: { type: 'string', description: 'The job_search.application_events ref of the request.' },
        verb: { type: 'string', enum: ['finish', 'put_off'], description: 'finish when it is dealt with; put_off for later.' },
      },
      required: ['event_ref', 'verb'],
      additionalProperties: false,
    },
    run: changeWaiting,
  },
  {
    name: 'review_application',
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
export async function jobsEnv(userId: string, db: AskDb): Promise<JobsWriteEnv> {
  return { userId, jobs: await db('job_search'), todo: await db('todo'), core: await db('core') };
}

/** The sentence for a person with Jobs switched off. */
export const JOBS_OFF = 'The Jobs workspace is switched off, so nothing can be changed there.';

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Jobs writes as Ask's write tools, run on the person's own clients. */
export const JOBS_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = JOBS_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('jobs')) return { ok: false, error: JOBS_OFF };
    const made = await runJobsWrite(write, await jobsEnv(ctx.userId, ctx.db), input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown> };
  },
}));

import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { JobsChangeInput, JobsChangeKind } from '@/lib/ask/jobs-changes';
import { toRef } from '@/lib/core/refs';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { extractCompBand, extractRequirements, jdHash } from '@/lib/jobs/jd/requirements';
import { APPLICATION_SOURCES, SOURCE_LABELS, type ApplicationSource } from '@/lib/jobs/pipeline';
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
 * Moving a role to another stage is move_roles (lib/dash/bulk-roles.ts), and
 * removing a pursuit deletes rows, which Dash never does.
 *
 * Each names one row as its subject and updates it, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept (#1894.4: an
 * agent's writes go straight in, each listed on Home with an Undo). A role
 * moved to a company that was not on file yet makes that company, as the
 * page's move does; the Undo puts the role back and leaves the company,
 * which then holds nothing.
 *
 * Both Ask and the connector run them, as News's (lib/dash/news-writes.ts):
 * Ask on the person's own clients, the connector on a service-role one for
 * the verified person. The service role passes no row level security, so
 * every row is read by its id and the person's user id before it is changed.
 */

export type JobsWriteEnv = {
  userId: string;
  jobs: SchemaClient;
};

/** A Jobs change as made, before a surface keeps it. */
export type JobsMade = {
  kind: JobsChangeKind;
  input: JobsChangeInput;
  subjectRef: string;
  op: 'update';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  summary: string;
  row: AskRow;
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
  };
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
    const made = await runJobsWrite(write, { userId: ctx.userId, jobs: await ctx.db('job_search') }, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown>, undo: null };
  },
}));

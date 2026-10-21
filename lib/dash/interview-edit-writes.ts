import {
  addInterviewerRow,
  interviewerContact,
  interviewersNamed,
  moveInterviewToRound,
  removeInterviewerRow,
  saveInterviewEdit,
  saveRoundEdit,
  unlinkRoundEmailRow,
} from '@/lib/jobs/interview/edit';
import { sameAs } from './runs';
import { isUuid, type AskDb, type SchemaClient } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import { formatNumber } from '@/lib/money';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { INTERVIEW_KINDS, interviewKindLabel } from '@/lib/jobs/interview-kinds';
import { insertInterviewRound } from '@/lib/jobs/interview/rounds';
import { wallClockToInstant } from '@/lib/todo/time';
import { JobsRefused } from './jobs-refused';
import type { JobsMade, JobsWrite, JobsWriteEnv } from './jobs-writes';

/**
 * The interview edits an agent makes when asked (plan #1894.6.9, feature
 * #1894.6), the ones the role page's interview cards let the person make by
 * hand (app/jobs/(app)/roles/[id]/interview-actions.ts):
 *
 *   change_interview        an interview's kind, status, date and time, notes
 *                           or prep notes (saveInterview).
 *   change_interviewer      someone named as an interviewer on an interview,
 *                           from their contacts or as a new contact, or taken
 *                           off it (addInterviewer, addInterviewerByName,
 *                           removeInterviewer).
 *   change_interview_round  a round's name, notes or number; rounds gathered
 *                           into one; an interview split out into a round of
 *                           its own; an email taken off a round
 *                           (saveInterviewGroup, groupInterviews,
 *                           ungroupInterview, unlinkRoundMessage).
 *
 * Adding a round, attaching an email to one and writing its prep note are
 * add_interview_round, link_round_email and write_prep_note
 * (lib/dash/interview-writes.ts, plan #2044). Deleting an interview or a round
 * stays the page's, since Dash never deletes what the person made.
 *
 * No lookup returns rounds, so a round is named the way #2044 names it: its
 * role and its number on that role. An interview is named by its
 * job_search.interviews ref (list_rows), or by its round and, when the round
 * holds more than one, its place in it.
 *
 * change_interview changes one row, so the one undo rule in
 * lib/core/dash-actions.ts puts it back. The other two can touch several
 * rows, so each keeps what it added, changed and took out in `undo`
 * (InterviewRowsUndo), and undoInterviewRows puts them back
 * (JOBS_MANY_ROW_KINDS sends their Undo there).
 */

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const INTERVIEWS = 'job_search.interviews';
const ROUNDS = 'job_search.interview_groups';
const PARTICIPANTS = 'job_search.interview_participants';

const STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled'] as const;
const STATUS_WORDS: Record<(typeof STATUSES)[number], string> = {
  scheduled: 'scheduled',
  completed: 'done',
  cancelled: 'cancelled',
  rescheduled: 'being rescheduled',
};

/** The limits the role page's forms set. */
const LABEL_MAX = 120;
const NOTES_MAX = 20_000;
const NAME_MAX = 120;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function given(args: Args, key: string): boolean {
  return args[key] !== undefined && args[key] !== null;
}

function idOf(value: string, what: string): string {
  if (!isUuid(value)) throw new JobsRefused(`That is not a ${what}'s ref, as a lookup returned it.`);
  return value;
}

async function ownRow(env: JobsWriteEnv, table: string, id: string, what: string): Promise<Row> {
  const { data, error } = await env.jobs.from(table).select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new JobsRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as Row;
}

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
  return (data ?? []) as Row[];
}

// ---------------------------------------------------------------------------
// Naming a role, a round and an interview
// ---------------------------------------------------------------------------

type Pursuit = { applicationId: string; roleId: string; roleName: string; href: string };

/** "Data Engineer at Acme", the way the role page heads itself. */
async function pursuitOf(env: JobsWriteEnv, application: Row): Promise<Pursuit> {
  const role = await ownRow(env, 'roles', application.role_id as string, 'role');
  let company: string | null = null;
  if (typeof role.company_id === 'string') {
    const { data } = await env.jobs.from('companies').select('name').eq('id', role.company_id).eq('user_id', env.userId).maybeSingle();
    const name = (data as Row | null)?.name;
    company = typeof name === 'string' && name.trim() ? name.trim() : null;
  }
  const title = typeof role.title === 'string' && role.title.trim() ? role.title.trim() : 'the role';
  const roleId = role.id as string;
  return {
    applicationId: application.id as string,
    roleId,
    roleName: company ? `${title} at ${company}` : title,
    href: `/jobs/roles/${roleId}`,
  };
}

/** The application a call names: by its ref, or the latest on a role, the one the role page shows. */
async function namedPursuit(env: JobsWriteEnv, args: Args): Promise<Pursuit> {
  const applicationRef = text(args, 'application_ref');
  if (applicationRef) return pursuitOf(env, await ownRow(env, 'applications', idOf(applicationRef, 'application'), 'application'));
  const roleRef = text(args, 'role_ref');
  if (!roleRef) throw new JobsRefused('Name the role: role_ref, or application_ref for its application.');
  const role = await ownRow(env, 'roles', idOf(roleRef, 'role'), 'role');
  const found = await rows(
    env.jobs.from('applications').select('*').eq('role_id', role.id as string).eq('user_id', env.userId).order('attempt', { ascending: false }).limit(1),
    'the application',
  );
  if (!found[0]) throw new JobsRefused('That role has no application, so it has no interviews.');
  return pursuitOf(env, found[0]);
}

function roundNumberOf(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99) {
    throw new JobsRefused(`${key} must be a round's number on the role, 1 to 99.`);
  }
  return value;
}

type Round = Row & { id: string };

function roundName(round: Row): string {
  const number = round.round_number;
  const label = typeof round.label === 'string' && round.label.trim() ? round.label.trim() : null;
  const base = typeof number === 'number' ? `round ${number}` : 'the round';
  return label ? `${base}, ${label}` : base;
}

/** The round on a pursuit with that number, refused when there is none. */
async function roundNumbered(env: JobsWriteEnv, pursuit: Pursuit, number: number): Promise<Round> {
  const found = await rows(
    env.jobs.from('interview_groups').select('*').eq('application_id', pursuit.applicationId).eq('round_number', number).eq('user_id', env.userId).limit(1),
    'the round',
  );
  if (!found[0]) throw new JobsRefused(`${pursuit.roleName} has no round ${number}.`);
  return found[0] as Round;
}

/** The interviews in a round, in the order the round shows them. */
async function interviewsIn(env: JobsWriteEnv, roundId: string): Promise<Row[]> {
  const found = await rows(env.jobs.from('interviews').select('*').eq('group_id', roundId).eq('user_id', env.userId), 'the interviews');
  return found.sort((a, b) => Number(a.round ?? 0) - Number(b.round ?? 0) || String(a.scheduled_at ?? '').localeCompare(String(b.scheduled_at ?? '')));
}

type Named = { interview: Row; round: Round; pursuit: Pursuit; name: string };

function interviewName(interview: Row, round: Row, pursuit: Pursuit): string {
  return `the ${interviewKindLabel(String(interview.kind)).toLowerCase()} interview in ${roundName(round)} of ${pursuit.roleName}`;
}

/**
 * The interview a call names: interview_ref, or the role, the round's number
 * and, when the round holds more than one, `interview`, its place in it.
 */
async function namedInterview(env: JobsWriteEnv, args: Args): Promise<Named> {
  const ref = text(args, 'interview_ref');
  if (ref) {
    const interview = await ownRow(env, 'interviews', idOf(ref, 'interview'), 'interview');
    const round = (await ownRow(env, 'interview_groups', interview.group_id as string, 'round')) as Round;
    const pursuit = await pursuitOf(env, await ownRow(env, 'applications', interview.application_id as string, 'application'));
    return { interview, round, pursuit, name: interviewName(interview, round, pursuit) };
  }
  if (!given(args, 'round_number')) throw new JobsRefused('Name the interview: interview_ref, or role_ref with round_number.');
  const pursuit = await namedPursuit(env, args);
  const round = await roundNumbered(env, pursuit, roundNumberOf(args.round_number, 'round_number'));
  const inside = await interviewsIn(env, round.id);
  if (inside.length === 0) throw new JobsRefused(`${roundName(round)} of ${pursuit.roleName} has no interview in it yet. Add one with add_interview_round.`);
  let place = 1;
  if (given(args, 'interview')) {
    const value = args.interview;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new JobsRefused('interview must be its place in the round, 1 or higher.');
    place = value;
  } else if (inside.length > 1) {
    const listed = inside.map((row, i) => `${i + 1} ${interviewKindLabel(String(row.kind))}`).join(', ');
    throw new JobsRefused(`${roundName(round)} of ${pursuit.roleName} holds ${inside.length} interviews (${listed}). Say which with interview.`);
  }
  const interview = inside[place - 1];
  if (!interview) throw new JobsRefused(`${roundName(round)} of ${pursuit.roleName} holds ${inside.length} interviews, not ${place}.`);
  return { interview, round, pursuit, name: interviewName(interview, round, pursuit) };
}

const pathsFor = (pursuit: Pursuit) => [pursuit.href, '/jobs/interviews', '/jobs'];

// ---------------------------------------------------------------------------
// What a change of several rows keeps, and its Undo
// ---------------------------------------------------------------------------

/**
 * What change_interviewer and change_interview_round keep in `undo`: the rows
 * they added, the columns they wrote on rows they changed (before and after),
 * and the rows they took out, whole. The Undo puts the taken-out rows back
 * first (a round before what goes in it), then the changed columns, newest
 * first, while a row still holds what Dash left, then takes out what was
 * added, newest first, so an interviewer goes before the contact made for it.
 */
export type InterviewRowsUndo = {
  added: { table: string; id: string }[];
  changed: { table: string; id: string; before: Row; after: Row }[];
  removed: { table: string; row: Row }[];
};

/** The tables these writes touch, the only ones their Undo writes to. */
const UNDO_TABLES = new Set(['interviews', 'interview_groups', 'interview_participants', 'interview_group_messages', 'contacts']);

/** The order taken-out rows go back in: a round before the interviews and links it holds. */
const PUT_BACK_ORDER = ['interview_groups', 'interviews', 'interview_group_messages', 'interview_participants'];

function emptyUndo(): InterviewRowsUndo {
  return { added: [], changed: [], removed: [] };
}

/** interview_participants has no user_id of its own: it is theirs when its interview is. */
async function ownsInterview(jobs: SchemaClient, userId: string, interviewId: unknown): Promise<boolean> {
  if (typeof interviewId !== 'string') return false;
  const { data, error } = await jobs.from('interviews').select('id').eq('id', interviewId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`interviews: ${error.message}`);
  return !!data;
}

async function changeKept(env: JobsWriteEnv, undo: InterviewRowsUndo, table: string, row: Row, update: Row): Promise<Row> {
  const { data, error } = await env.jobs.from(table).update(update).eq('id', row.id as string).eq('user_id', env.userId).select('*');
  if (error) throw new Error(`Changing ${table} failed: ${error.message}`);
  const written = ((data ?? []) as Row[])[0];
  if (!written) throw new JobsRefused('That changed while Dash was writing it. Nothing more was changed.');
  undo.changed.push({
    table,
    id: row.id as string,
    before: Object.fromEntries(Object.keys(update).map((column) => [column, row[column] ?? null])),
    after: Object.fromEntries(Object.keys(update).map((column) => [column, written[column] ?? null])),
  });
  return written;
}

const jobsDb = (env: JobsWriteEnv) => env.jobs as unknown as AppSupabaseClient;

/** A row a shared write changed, kept with the columns it wrote before and after. */
async function changedBy(undo: InterviewRowsUndo, table: string, row: Row, update: Row, write: Promise<{ row: Row | null; error: string | null }>): Promise<Row> {
  const { row: written, error } = await write;
  if (error) throw new Error(`Changing ${table} failed: ${error}`);
  if (!written) throw new JobsRefused('That changed while Dash was writing it. Nothing more was changed.');
  undo.changed.push({
    table,
    id: row.id as string,
    before: Object.fromEntries(Object.keys(update).map((column) => [column, row[column] ?? null])),
    after: Object.fromEntries(Object.keys(update).map((column) => [column, written[column] ?? null])),
  });
  return written;
}

/** Rows a shared write took out, kept whole for the Undo. */
async function removedBy(undo: InterviewRowsUndo, table: string, write: Promise<{ rows: Row[]; error: string | null }>): Promise<void> {
  const { rows: taken, error } = await write;
  if (error) throw new Error(`Taking out of ${table} failed: ${error}`);
  for (const row of taken) undo.removed.push({ table, row });
}

/** Take a row out, keeping it whole. interview_participants is scoped by its interview, which the caller has checked is theirs. */
async function removeKept(env: JobsWriteEnv, undo: InterviewRowsUndo, table: string, row: Row): Promise<void> {
  let query = env.jobs.from(table).delete().eq('id', row.id as string);
  if (table !== 'interview_participants') query = query.eq('user_id', env.userId);
  const { error } = await query.select('id');
  if (error) throw new Error(`Taking out of ${table} failed: ${error.message}`);
  undo.removed.push({ table, row });
}

/** A failed change of several rows puts back what it had done, then fails. */
async function backOut(env: JobsWriteEnv, undo: InterviewRowsUndo, error: unknown, kind: string): Promise<never> {
  try {
    await putBackInterviewRows({ userId: env.userId, db: async () => env.jobs }, undo);
  } catch (putBack) {
    console.error(`${kind}: putting a failed change back failed`, putBack);
  }
  throw error;
}

function scalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function interviewRowsUndo(value: Record<string, unknown> | null): InterviewRowsUndo | null {
  if (!value) return null;
  const isRow = (row: unknown): row is Row => !!row && typeof row === 'object' && !Array.isArray(row);
  const known = (table: unknown) => typeof table === 'string' && UNDO_TABLES.has(table);
  const added = (Array.isArray(value.added) ? value.added : [])
    .filter(isRow)
    .filter((row) => known(row.table) && typeof row.id === 'string' && isUuid(row.id));
  const changed = (Array.isArray(value.changed) ? value.changed : [])
    .filter(isRow)
    .filter((row) => known(row.table) && typeof row.id === 'string' && isUuid(row.id) && isRow(row.before) && isRow(row.after));
  const removed = (Array.isArray(value.removed) ? value.removed : [])
    .filter(isRow)
    .filter((row) => known(row.table) && isRow(row.row) && typeof row.row.id === 'string' && isUuid(row.row.id));
  if (added.length + changed.length + removed.length === 0) return null;
  return {
    added: added.map((row) => ({ table: row.table as string, id: row.id as string })),
    changed: changed.map((row) => ({ table: row.table as string, id: row.id as string, before: row.before as Row, after: row.after as Row })),
    removed: removed.map((row) => ({ table: row.table as string, row: row.row as Row })),
  };
}

/** What hangs on a contact besides the interviewer rows this change added. */
const CONTACT_HOLDERS = ['contact_touches', 'notes', 'reminders', 'attachments', 'suggestions'];

async function contactHolds(jobs: SchemaClient, userId: string, contactId: string, addedIds: Set<string>): Promise<boolean> {
  const { data: on, error: onError } = await jobs.from('interview_participants').select('id').eq('contact_id', contactId);
  if (onError) throw new Error(`interview_participants: ${onError.message}`);
  if (((on ?? []) as Row[]).some((row) => !addedIds.has(row.id as string))) return true;
  for (const table of CONTACT_HOLDERS) {
    const { data, error } = await jobs.from(table).select('id').eq('contact_id', contactId).eq('user_id', userId).limit(1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

/** Put back what an interview change kept; how many rows went back. */
async function putBackInterviewRows(deps: { userId: string; db: AskDb }, undo: InterviewRowsUndo): Promise<number> {
  const jobs = await deps.db('job_search');
  let restored = 0;

  const removed = [...undo.removed].sort((a, b) => PUT_BACK_ORDER.indexOf(a.table) - PUT_BACK_ORDER.indexOf(b.table));
  for (const { table, row } of removed) {
    if (table === 'interview_participants' ? !(await ownsInterview(jobs, deps.userId, row.interview_id)) : row.user_id !== deps.userId) continue;
    const { data: there, error: thereError } = await jobs.from(table).select('id').eq('id', row.id as string).maybeSingle();
    if (thereError) throw new Error(`${table}: ${thereError.message}`);
    if (there) continue;
    const { error } = await jobs.from(table).insert(row).select('id');
    if (error) throw new Error(`${table}: ${error.message}`);
    restored += 1;
  }

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
    let query = jobs.from(row.table).delete().eq('id', row.id);
    if (row.table === 'interview_participants') {
      const { data: held } = await jobs.from(row.table).select('interview_id').eq('id', row.id).maybeSingle();
      if (!held || !(await ownsInterview(jobs, deps.userId, (held as Row).interview_id))) continue;
    } else {
      query = query.eq('user_id', deps.userId);
    }
    // A contact made for an interviewer stays once anything else hangs on it.
    if (row.table === 'contacts' && (await contactHolds(jobs, deps.userId, row.id, addedIds))) continue;
    // A round made to hold an interview stays once anything has gone back into it.
    if (row.table === 'interview_groups') {
      const { data: inside, error: insideError } = await jobs.from('interviews').select('id').eq('group_id', row.id).limit(1);
      if (insideError) throw new Error(`interviews: ${insideError.message}`);
      if ((inside ?? []).length > 0) continue;
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }
  return restored;
}

/**
 * Undo an interviewer named or taken off, or a round changed, from what it
 * kept (InterviewRowsUndo). Ask's undo calls it for every surface
 * (lib/ask/changes.ts, undoMany).
 */
export async function undoInterviewRows(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = interviewRowsUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  const restored = await putBackInterviewRows(deps, undo);
  if (restored === 0) {
    return { ok: false, error: 'Everything this changed has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// change_interview
// ---------------------------------------------------------------------------

async function timezoneOf(env: JobsWriteEnv): Promise<string> {
  const { data } = await env.core.from('account_settings').select('timezone').eq('user_id', env.userId).maybeSingle();
  const zone = (data as Row | null)?.timezone;
  return typeof zone === 'string' && zone ? zone : 'UTC';
}

/** An interview's kind, status, when, notes and prep notes, as its card edits them. */
async function changeInterview(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const { interview, round, pursuit, name } = await namedInterview(env, args);
  const update: Row = {};
  const said: string[] = [];

  if (given(args, 'kind')) {
    const kind = text(args, 'kind');
    if (!(INTERVIEW_KINDS as readonly string[]).includes(kind)) throw new JobsRefused(`kind must be one of: ${INTERVIEW_KINDS.join(', ')}.`);
    if (kind !== interview.kind) {
      update.kind = kind;
      said.push(`made it ${interviewKindLabel(kind).toLowerCase()}`);
    }
  }
  if (given(args, 'status')) {
    const status = text(args, 'status');
    if (!(STATUSES as readonly string[]).includes(status)) throw new JobsRefused(`status must be one of: ${STATUSES.join(', ')}.`);
    if (status !== interview.status) {
      update.status = status;
      said.push(`marked it ${STATUS_WORDS[status as (typeof STATUSES)[number]]}`);
    }
  }
  if (given(args, 'date')) {
    const day = text(args, 'date');
    const time = text(args, 'time');
    if (!day) {
      if (time) throw new JobsRefused('time needs a date: give the day as well, YYYY-MM-DD.');
      update.scheduled_at = null;
      update.time_known = false;
      said.push('cleared its date');
    } else {
      if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new JobsRefused('date must be a day, YYYY-MM-DD.');
      if (time && !TIME.test(time)) throw new JobsRefused('time must be HH:MM.');
      update.scheduled_at = wallClockToInstant(day, time || '00:00', await timezoneOf(env));
      update.time_known = time !== '';
      said.push(time ? `moved it to ${day} at ${time}` : `moved it to ${day}`);
    }
  } else if (given(args, 'time')) {
    throw new JobsRefused('time needs a date: give the day as well, YYYY-MM-DD.');
  }
  for (const [key, column, words] of [
    ['notes', 'notes', 'its notes'],
    ['prep_notes', 'prep_notes', 'its prep notes'],
  ] as const) {
    if (!given(args, key)) continue;
    const value = text(args, key);
    if (value.length > NOTES_MAX) throw new JobsRefused(`Keep ${key} under ${formatNumber(NOTES_MAX)} characters.`);
    if ((value || null) === (interview[column] ?? null)) continue;
    update[column] = value || null;
    said.push(value ? `wrote ${words}` : `cleared ${words}`);
  }
  if (said.length === 0) throw new JobsRefused(`Nothing to change: ${name} already reads that way.`);

  // The same write as the interview's card on the role page.
  const { row: after, error } = await saveInterviewEdit(jobsDb(env), env.userId, interview.id as string, update);
  if (error || !after) throw new Error(`Changing the interview failed: ${error ?? 'no row'}`);
  const done = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}` : said[0];
  return {
    kind: 'change_interview',
    input: { verb: 'Changed', what: name, rest: `: ${done}`, href: pursuit.href, where: 'Open the role', paths: pathsFor(pursuit) },
    subjectRef: toRef(INTERVIEWS, after.id as string),
    op: 'update',
    before: interview,
    after,
    summary: `Dash changed ${name}: ${done}.`,
    row: { table: INTERVIEWS, ref: after.id as string, title: `${interviewKindLabel(String(after.kind))}, ${roundName(round)}`, href: pursuit.href },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// change_interviewer
// ---------------------------------------------------------------------------

/** The contacts of theirs with that name, ignoring case. */
async function contactsNamed(env: JobsWriteEnv, name: string): Promise<Row[]> {
  return rows(
    env.jobs.from('contacts').select('*').eq('user_id', env.userId).ilike('full_name', name.replace(/[\\%_]/g, (c) => `\\${c}`)),
    'their contacts',
  );
}

/**
 * Someone named as an interviewer on an interview, or taken off it. Adding by
 * name attaches the contact of that name at the role's company, or makes one
 * there, as the round's "add someone new" does.
 */
async function changeInterviewer(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const action = text(args, 'action');
  if (action !== 'add' && action !== 'remove') throw new JobsRefused('action must be add or remove.');
  const { interview, pursuit, name } = await namedInterview(env, args);
  const contactRef = text(args, 'contact_ref');
  const personName = text(args, 'name');
  if (!contactRef && !personName) throw new JobsRefused('Name the person: contact_ref, or name.');
  if (personName.length > NAME_MAX) throw new JobsRefused(`Keep name under ${NAME_MAX} characters.`);

  const onIt = await rows(env.jobs.from('interview_participants').select('*').eq('interview_id', interview.id as string), 'who is on the interview');
  const undo = emptyUndo();

  if (action === 'remove') {
    let contactIds: string[];
    if (contactRef) contactIds = [idOf(contactRef, 'contact')];
    else contactIds = (await contactsNamed(env, personName)).map((row) => row.id as string);
    const matches = onIt.filter((row) => contactIds.includes(row.contact_id as string));
    if (matches.length === 0) throw new JobsRefused(`${contactRef ? 'That contact' : personName} is not named on ${name}.`);
    if (matches.length > 1) throw new JobsRefused(`More than one ${personName} is named on ${name}. Give contact_ref.`);
    const contact = await ownRow(env, 'contacts', matches[0].contact_id as string, 'contact');
    // The same write as the round's remove.
    await removedBy(undo, 'interview_participants', removeInterviewerRow(jobsDb(env), interview.id as string, contact.id as string));
    const who = String(contact.full_name ?? 'them');
    return {
      kind: 'change_interviewer',
      input: { verb: 'Took', what: who, rest: ` off ${name}`, href: pursuit.href, where: 'Open the role', paths: pathsFor(pursuit) },
      subjectRef: toRef(INTERVIEWS, interview.id as string),
      op: 'update',
      before: interview,
      after: interview,
      summary: `Dash took ${who} off ${name}.`,
      row: { table: 'job_search.contacts', ref: contact.id as string, title: who, href: pursuit.href },
      undo: undo as unknown as Record<string, unknown>,
    };
  }

  let contact: Row;
  let made = false;
  if (contactRef) {
    contact = await ownRow(env, 'contacts', idOf(contactRef, 'contact'), 'contact');
  } else {
    const role = await ownRow(env, 'roles', pursuit.roleId, 'role');
    const companyId = (role.company_id as string | null) ?? null;
    const same = await interviewersNamed(jobsDb(env), env.userId, companyId, personName);
    if (same.error) throw new Error(`Reading their contacts failed: ${same.error}`);
    if (same.rows.length > 1) throw new JobsRefused(`They have more than one contact called ${personName} there. Give contact_ref.`);
    // As the round's "add someone new": the one of that name there, or a new contact.
    const found = await interviewerContact(jobsDb(env), env.userId, companyId, personName);
    if (found.error || !found.contact) throw new Error(`Adding the contact failed: ${found.error ?? 'no row'}`);
    contact = found.contact;
    made = found.made;
    if (made) undo.added.push({ table: 'contacts', id: contact.id as string });
  }
  const who = String(contact.full_name ?? personName);
  if (onIt.some((row) => row.contact_id === contact.id)) throw new JobsRefused(`${who} is already named on ${name}. Nothing was changed; tell them so.`);
  let participant: Row;
  try {
    // The same write as the round's add.
    const { row, error } = await addInterviewerRow(jobsDb(env), interview.id as string, contact.id as string);
    if (error || !row) throw new Error(`Adding to interview_participants failed: ${error ?? 'no row'}`);
    undo.added.push({ table: 'interview_participants', id: row.id as string });
    participant = row;
  } catch (error) {
    return backOut(env, undo, error, 'change_interviewer');
  }
  const also = made ? ', as a new contact' : '';
  return {
    kind: 'change_interviewer',
    input: { verb: 'Named', what: who, rest: ` as an interviewer on ${name}${also}`, href: pursuit.href, where: 'Open the role', paths: [...pathsFor(pursuit), '/jobs/contacts'] },
    subjectRef: toRef(PARTICIPANTS, participant.id as string),
    op: 'insert',
    before: null,
    after: participant,
    summary: `Dash named ${who} as an interviewer on ${name}${also}.`,
    row: { table: 'job_search.contacts', ref: contact.id as string, title: who, href: pursuit.href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// change_interview_round
// ---------------------------------------------------------------------------

const ROUND_ACTIONS = ['edit', 'group', 'split', 'detach_email'] as const;

/** The email a call names among those on a round: by the ref search_mail returned or its inbox ref, or the only one there. */
async function roundEmail(env: JobsWriteEnv, round: Round, ref: string, where: string): Promise<Row> {
  const links = await rows(env.jobs.from('interview_group_messages').select('*').eq('group_id', round.id).eq('user_id', env.userId), 'the round\'s emails');
  if (links.length === 0) throw new JobsRefused(`${where} has no email attached.`);
  if (!ref) {
    if (links.length > 1) throw new JobsRefused(`${where} has ${links.length} emails attached. Say which with message_ref, the ref search_mail returned.`);
    return links[0];
  }
  let query = env.jobs.from('inbox_messages').select('id').eq('user_id', env.userId);
  if (isUuid(ref)) query = query.eq('id', ref);
  else {
    const at = ref.indexOf(':');
    if (at <= 0 || !isUuid(ref.slice(0, at))) throw new JobsRefused('message_ref must be the ref search_mail returned for the email.');
    query = query.eq('email_account_id', ref.slice(0, at)).eq('provider_message_id', ref.slice(at + 1));
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Reading the email failed: ${error.message}`);
  const link = data ? links.find((row) => row.message_id === (data as Row).id) : undefined;
  if (!link) throw new JobsRefused(`That email is not attached to ${where}. Nothing was changed; tell them so.`);
  return link;
}

function roundMade(
  pursuit: Pursuit,
  subject: Round,
  before: Row,
  undo: InterviewRowsUndo,
  verb: string,
  what: string,
  rest: string,
  summary: string,
): JobsMade {
  return {
    kind: 'change_interview_round',
    input: { verb, what, rest, href: pursuit.href, where: 'Open the role', paths: pathsFor(pursuit) },
    subjectRef: toRef(ROUNDS, subject.id),
    op: 'update',
    before,
    after: subject,
    summary,
    row: { table: ROUNDS, ref: subject.id, title: roundName(subject), href: pursuit.href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

/** A round's name, notes or number, as its card edits them. */
async function editRound(env: JobsWriteEnv, args: Args, pursuit: Pursuit): Promise<JobsMade> {
  const round = await roundNumbered(env, pursuit, roundNumberOf(args.round_number, 'round_number'));
  const where = `${roundName(round)} of ${pursuit.roleName}`;
  const update: Row = {};
  const said: string[] = [];
  if (given(args, 'label')) {
    const label = text(args, 'label');
    if (label.length > LABEL_MAX) throw new JobsRefused(`Keep label under ${LABEL_MAX} characters.`);
    if ((label || null) !== (round.label ?? null)) {
      update.label = label || null;
      said.push(label ? `named it "${label}"` : 'cleared its name');
    }
  }
  if (given(args, 'notes')) {
    const notes = text(args, 'notes');
    if (notes.length > NOTES_MAX) throw new JobsRefused(`Keep notes under ${formatNumber(NOTES_MAX)} characters.`);
    if ((notes || null) !== (round.notes ?? null)) {
      update.notes = notes || null;
      said.push(notes ? 'wrote its notes' : 'cleared its notes');
    }
  }
  if (given(args, 'new_round_number')) {
    const number = roundNumberOf(args.new_round_number, 'new_round_number');
    if (number !== round.round_number) {
      update.round_number = number;
      said.push(`made it round ${number}`);
    }
  }
  if (said.length === 0) throw new JobsRefused(`Nothing to change: ${where} already reads that way.`);
  const undo = emptyUndo();
  // The same write as the round card's name, notes and number.
  const after = (await changedBy(undo, 'interview_groups', round, update, saveRoundEdit(jobsDb(env), env.userId, round.id, update))) as Round;
  const done = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}` : said[0];
  return roundMade(pursuit, after, round, undo, 'Changed', where, `: ${done}`, `Dash changed ${where}: ${done}.`);
}

/**
 * Rounds gathered into one, as the role page's "group" does: the interviews
 * and emails of the later rounds move into the first named, each keeping its
 * hour, panel and notes, and the rounds left empty are taken out. A round
 * with notes of its own is refused rather than lost.
 */
async function groupRounds(env: JobsWriteEnv, args: Args, pursuit: Pursuit): Promise<JobsMade> {
  const numbers = Array.isArray(args.round_numbers) ? args.round_numbers.map((n) => roundNumberOf(n, 'round_numbers')) : [];
  const distinct = [...new Set(numbers)].sort((a, b) => a - b);
  if (distinct.length < 2) throw new JobsRefused('round_numbers must name at least two rounds on the role to gather into one.');
  const rounds: Round[] = [];
  for (const number of distinct) rounds.push(await roundNumbered(env, pursuit, number));
  const [kept, ...folded] = rounds;
  const withNotes = folded.find((round) => typeof round.notes === 'string' && round.notes.trim());
  if (withNotes) {
    throw new JobsRefused(`${roundName(withNotes)} of ${pursuit.roleName} has notes of its own. Copy them into round ${kept.round_number}'s notes first, or clear them.`);
  }
  const label = text(args, 'label');
  if (label.length > LABEL_MAX) throw new JobsRefused(`Keep label under ${LABEL_MAX} characters.`);

  const undo = emptyUndo();
  try {
    let place = (await interviewsIn(env, kept.id)).length;
    const keptLinks = new Set((await rows(env.jobs.from('interview_group_messages').select('message_id').eq('group_id', kept.id), 'the round\'s emails')).map((row) => row.message_id));
    for (const round of folded) {
      for (const interview of await interviewsIn(env, round.id)) {
        place += 1;
        await changeKept(env, undo, 'interviews', interview, { group_id: kept.id, round: place });
      }
      const links = await rows(env.jobs.from('interview_group_messages').select('*').eq('group_id', round.id).eq('user_id', env.userId), 'the round\'s emails');
      for (const link of links) {
        if (keptLinks.has(link.message_id)) await removeKept(env, undo, 'interview_group_messages', link);
        else {
          await changeKept(env, undo, 'interview_group_messages', link, { group_id: kept.id });
          keptLinks.add(link.message_id);
        }
      }
      await removeKept(env, undo, 'interview_groups', round);
    }
  } catch (error) {
    return backOut(env, undo, error, 'change_interview_round');
  }
  const after = label && label !== kept.label ? ((await changeKept(env, undo, 'interview_groups', kept, { label })) as Round) : kept;
  const gathered = folded.map((round) => `round ${round.round_number}`);
  const from = gathered.length > 1 ? `${gathered.slice(0, -1).join(', ')} and ${gathered[gathered.length - 1]}` : gathered[0];
  const where = `${roundName(after)} of ${pursuit.roleName}`;
  return roundMade(pursuit, after, kept, undo, 'Gathered', from, ` into ${where}`, `Dash gathered ${from} into ${where}.`);
}

/** One interview moved out of its round into a round of its own, numbered after the others. */
async function splitInterview(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const { interview, round, pursuit, name } = await namedInterview(env, args);
  if ((await interviewsIn(env, round.id)).length < 2) throw new JobsRefused(`${name} is the only interview in its round already. Nothing was changed; tell them so.`);
  const undo = emptyUndo();
  // As the round card's "not part of this round": a round of its own, numbered after the others.
  const made = await insertInterviewRound(jobsDb(env), { userId: env.userId, applicationId: pursuit.applicationId });
  if (made.error || !made.id) throw new Error(`Adding the round failed: ${made.error ?? 'no row'}`);
  undo.added.push({ table: 'interview_groups', id: made.id });
  const fresh = (await ownRow(env, 'interview_groups', made.id, 'round')) as Round;
  const number = fresh.round_number;
  try {
    const moved = { group_id: fresh.id, round: 1 };
    await changedBy(undo, 'interviews', interview, moved, moveInterviewToRound(jobsDb(env), env.userId, interview.id as string, fresh.id, 1));
  } catch (error) {
    return backOut(env, undo, error, 'change_interview_round');
  }
  const where = `round ${number} of ${pursuit.roleName}`;
  return roundMade(pursuit, fresh, fresh, undo, 'Moved', name, ` into a round of its own, ${where}`, `Dash moved ${name} into a round of its own, ${where}.`);
}

/** An email taken off a round. It stays on the role's timeline; only the statement that it belongs to the round goes. */
async function detachEmail(env: JobsWriteEnv, args: Args, pursuit: Pursuit): Promise<JobsMade> {
  const round = await roundNumbered(env, pursuit, roundNumberOf(args.round_number, 'round_number'));
  const where = `${roundName(round)} of ${pursuit.roleName}`;
  const link = await roundEmail(env, round, text(args, 'message_ref'), where);
  const undo = emptyUndo();
  // The same write as the round's "take this email off".
  await removedBy(undo, 'interview_group_messages', unlinkRoundEmailRow(jobsDb(env), env.userId, round.id, link.message_id as string));
  return roundMade(pursuit, round, round, undo, 'Took an email off', where, '; it stays on the role', `Dash took an email off ${where}. It stays on the role's timeline.`);
}

async function changeInterviewRound(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const action = text(args, 'action');
  if (!(ROUND_ACTIONS as readonly string[]).includes(action)) throw new JobsRefused(`action must be one of: ${ROUND_ACTIONS.join(', ')}.`);
  if (action === 'split') return splitInterview(env, args);
  const pursuit = await namedPursuit(env, args);
  if (action === 'group') return groupRounds(env, args, pursuit);
  if (action === 'detach_email') return detachEmail(env, args, pursuit);
  return editRound(env, args, pursuit);
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const ROLE_REF = { type: 'string', description: 'The job_search.roles ref a lookup returned for the role.' } as const;
const APPLICATION_REF = { type: 'string', description: 'Instead of role_ref: the job_search.applications ref job_applications returned.' } as const;
const ROUND_NUMBER = { type: 'integer', minimum: 1, description: "The round's number on the role, as add_interview_round gave it or the role page shows it." } as const;
const INTERVIEW_REF = { type: 'string', description: 'The job_search.interviews ref list_rows returned. Instead, name it by role_ref and round_number.' } as const;
const INTERVIEW_PLACE = { type: 'integer', minimum: 1, description: 'Its place in the round, 1 first, when the round holds more than one interview.' } as const;

export const INTERVIEW_EDIT_WRITES: readonly JobsWrite[] = [
  {
    name: 'change_interview',
    runs: sameAs(
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#saveInterview', 'lib/jobs/interview/edit.ts#saveInterviewEdit'],
    ),
    description: `Correct an interview on one of their roles in Jobs when they ask, as its card on the role page does: its kind (${INTERVIEW_KINDS.join(', ')}), its status (${STATUSES.join(', ')}; completed when it has happened), its date and time, what they noted about it, or their prep notes. Name it by role_ref and round_number (plus interview, its place, when the round holds several), or by interview_ref. Pass only what they asked to change; an empty date clears it, and an empty notes or prep_notes clears that.`,
    input_schema: {
      type: 'object',
      properties: {
        role_ref: ROLE_REF,
        application_ref: APPLICATION_REF,
        round_number: ROUND_NUMBER,
        interview: INTERVIEW_PLACE,
        interview_ref: INTERVIEW_REF,
        kind: { type: 'string', enum: [...INTERVIEW_KINDS] },
        status: { type: 'string', enum: [...STATUSES] },
        date: { type: 'string', description: 'The day, YYYY-MM-DD, in their timezone. An empty string clears the date.' },
        time: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'The time on that day, HH:MM, only when they gave one.' },
        notes: { type: 'string', description: 'What they noted about it, in full. An empty string clears it.' },
        prep_notes: { type: 'string', description: 'Their prep notes for it, in full. An empty string clears them.' },
      },
      additionalProperties: false,
    },
    run: changeInterview,
  },
  {
    name: 'change_interviewer',
    runs: sameAs(
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#addInterviewer', 'lib/jobs/interview/edit.ts#addInterviewerRow'],
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#addInterviewerByName', 'lib/jobs/interview/edit.ts#interviewerContact'],
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#removeInterviewer', 'lib/jobs/interview/edit.ts#removeInterviewerRow'],
    ),
    description:
      "Name who interviewed them, or take someone off an interview, on one of their roles in Jobs when they ask (\"Priya Shah ran my technical round at Stripe\"). action add names them: by contact_ref when they are a contact (search their contacts first), or by name, which attaches the contact of that name at the role's company or adds them there as a new contact. action remove takes them off by contact_ref or name; the contact itself stays. Name the interview by role_ref and round_number (plus interview when the round holds several), or by interview_ref.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'] },
        role_ref: ROLE_REF,
        application_ref: APPLICATION_REF,
        round_number: ROUND_NUMBER,
        interview: INTERVIEW_PLACE,
        interview_ref: INTERVIEW_REF,
        contact_ref: { type: 'string', description: 'The job_search.contacts ref of the person.' },
        name: { type: 'string', description: 'Instead of contact_ref: their full name.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: changeInterviewer,
  },
  {
    name: 'change_interview_round',
    runs: sameAs(
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#groupInterviews', 'app/jobs/(app)/roles/[id]/interview-actions.ts#groupInterviews'],
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#saveInterviewGroup', 'lib/jobs/interview/edit.ts#saveRoundEdit'],
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#unlinkRoundMessage', 'lib/jobs/interview/edit.ts#unlinkRoundEmailRow'],
      ['app/jobs/(app)/roles/[id]/interview-actions.ts#ungroupInterview', 'lib/jobs/interview/edit.ts#moveInterviewToRound'],
    ),
    description:
      "Change the interview rounds on one of their roles in Jobs when they ask, as the role page does. action edit renames a round (label), writes how the round went as a whole (notes) or renumbers it (new_round_number). action group gathers rounds into one (round_numbers, at least two): the interviews and emails of the later rounds move into the first, each keeping its own notes, and the emptied rounds go; a round with notes of its own is refused. action split moves one interview out of a round it shares into a round of its own, numbered after the others. action detach_email takes an email off a round (message_ref from search_mail, needed when it has several); the email stays on the role. Name the role by role_ref, and the round by round_number; split names the interview as change_interview does.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ROUND_ACTIONS] },
        role_ref: ROLE_REF,
        application_ref: APPLICATION_REF,
        round_number: ROUND_NUMBER,
        round_numbers: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'For group: the rounds to gather, by number.' },
        interview: INTERVIEW_PLACE,
        interview_ref: INTERVIEW_REF,
        label: { type: 'string', description: "For edit or group: the round's name. An empty string clears it on edit." },
        notes: { type: 'string', description: 'For edit: how the round went as a whole, in full. An empty string clears it.' },
        new_round_number: { type: 'integer', minimum: 1, description: 'For edit: the number the round should have.' },
        message_ref: { type: 'string', description: 'For detach_email: the ref search_mail returned for the email.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: changeInterviewRound,
  },
];

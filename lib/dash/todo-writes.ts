import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { TodoChangeInput, TodoChangeKind } from '@/lib/ask/todo-changes';
import { toRef } from '@/lib/core/refs';
import { eventInput, resolveSpan } from '@/lib/todo/events/write';
import { appointmentRefFor } from '@/lib/todo/links/load';
import { APPOINTMENT_COLUMNS, isLinkTarget, LINK_TARGETS, TARGET_COLUMNS, type LinkTarget } from '@/lib/todo/links/model';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { taskInput } from '@/lib/todo/tasks/input';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The Todo changes an agent makes when asked (plan #1894.9.1, feature #1894),
 * beyond add_todo, change_todo and close_todo (lib/dash/writes.ts).
 *
 *   edit_todo      a todo's notes, its pin, putting it off for a week or
 *                  bringing it back, dropping it, or reopening it.
 *   add_todo_item  one more item on a todo's list.
 *   link_todo      what a todo is about: a role, a note, an order, a goal
 *                  and the rest of the targets a todo can point at.
 *   add_event      an event on their own calendar.
 *   change_event   one of those events renamed, moved, or its place or
 *                  notes changed.
 *
 * Each is one row, inserted or updated, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept (#1894.4: an
 * agent's writes go straight in, each listed on Home with an Undo).
 *
 * Both Ask and the connector run them, as Learn's (lib/dash/learn-writes.ts):
 * Ask on the person's own todo client, the connector on a service-role one
 * for the verified person. The service role passes no row level security, so
 * every read and write here names the person's user id itself. A link's
 * target is checked by the database: task_links_target_is_owned refuses a
 * target that belongs to anyone but the todo's owner.
 */

/** Who the change is for, their todo client, and their zone for times of day. */
export type TodoWriteEnv = { userId: string; todo: SchemaClient; timezone: string };

/** A Todo change as made, before a surface keeps it. */
export type TodoMade = {
  kind: TodoChangeKind;
  input: TodoChangeInput;
  subjectRef: string;
  op: 'insert' | 'update';
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  summary: string;
  row: AskRow;
};

export type TodoWrite = {
  name: TodoChangeKind;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: TodoWriteEnv, args: Args) => Promise<TodoMade>;
};

/** A refusal the model reads and says in words. */
export class TodoRefused extends Error {}

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const TODO_PATHS = ['/todo', '/todo/all', '/home'];

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function sent(args: Args, key: string): boolean {
  return key in args && args[key] !== undefined && args[key] !== null;
}

function idOf(args: Args, key: string, what: string): string {
  const id = text(args, key);
  if (!id) throw new TodoRefused(`${key} is missing: give the ${what}'s ref from a lookup.`);
  if (!isUuid(id)) throw new TodoRefused(`${key} must be a ${what}'s ref, as a lookup returned it.`);
  return id;
}

function bool(args: Args, key: string): boolean {
  if (typeof args[key] !== 'boolean') throw new TodoRefused(`${key} must be true or false.`);
  return args[key] as boolean;
}

/** "Book the dentist", cut to a line. */
function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

function listed(said: string[]): string {
  return said.length === 1 ? said[0] : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
}

const todoHref = (id: string) => `/todo/all?status=all&focus=${id}`;

async function ownRow(env: TodoWriteEnv, table: string, id: string, what: string): Promise<Row> {
  const { data, error } = await env.todo.from(table).select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new TodoRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as Row;
}

async function updated(env: TodoWriteEnv, table: string, id: string, patch: Row, what: string): Promise<Row> {
  const { data, error } = await env.todo
    .from(table)
    .update(patch)
    .eq('id', id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Changing the ${what} failed: ${error?.message ?? 'no row'}`);
  return data as Row;
}

async function inserted(env: TodoWriteEnv, table: string, row: Row, what: string): Promise<Row> {
  const { data, error } = await env.todo.from(table).insert(row).select('*').single();
  if (error || !data) throw new Error(`Adding the ${what} failed: ${error?.message ?? 'no row'}`);
  return data as Row;
}

// ---------------------------------------------------------------------------
// edit_todo
// ---------------------------------------------------------------------------

const TODO_STATES = ['open', 'dropped'] as const;

async function editTodo(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const id = idOf(args, 'todo_ref', 'todo');
  const before = await ownRow(env, 'tasks', id, 'todo');
  const title = named(before.title, 'the todo');
  const patch: Row = {};
  const said: string[] = [];

  if (sent(args, 'notes')) {
    if (typeof args.notes !== 'string') throw new TodoRefused('notes must be text.');
    const parsed = taskInput.shape.body.safeParse(args.notes);
    if (!parsed.success) throw new TodoRefused('Keep the notes under 20,000 characters.');
    patch.body = parsed.data;
    said.push(parsed.data ? 'its notes written' : 'its notes cleared');
  }
  if (sent(args, 'pinned')) {
    const pinned = bool(args, 'pinned');
    patch.pinned = pinned;
    said.push(pinned ? 'pinned' : 'unpinned');
  }
  if (sent(args, 'later')) {
    // "Later" on the row: out of sight for a week, still open, still due when it was.
    const later = bool(args, 'later');
    if (later) {
      const until = new Date();
      until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
      patch.snoozed_until = until.toISOString();
    } else {
      patch.snoozed_until = null;
    }
    said.push(later ? `put off for ${SNOOZE_DAYS} days` : 'brought back');
  }
  if (sent(args, 'state')) {
    const state = text(args, 'state') as (typeof TODO_STATES)[number];
    if (!TODO_STATES.includes(state)) throw new TodoRefused(`state must be one of ${TODO_STATES.join(', ')}.`);
    if (before.status === state) throw new TodoRefused(`That todo is ${state} already.`);
    // The database stamps completed_at and dropped_at from the status.
    patch.status = state;
    said.push(state === 'open' ? 'reopened' : 'dropped');
  }
  if (said.length === 0) throw new TodoRefused('Say what to change: notes, pinned, later or state.');

  const after = await updated(env, 'tasks', id, patch, 'todo');
  const href = todoHref(id);
  return {
    kind: 'edit_todo',
    input: { verb: 'Changed', what: title, rest: `: ${listed(said)}`, href, where: 'Open in Todo', paths: TODO_PATHS },
    subjectRef: toRef('todo.tasks', id),
    op: 'update',
    before,
    after,
    summary: `Dash changed the todo "${title}": ${listed(said)}.`,
    row: { table: 'todo.tasks', ref: id, title, href, detail: { status: String(after.status) } },
  };
}

// ---------------------------------------------------------------------------
// add_todo_item
// ---------------------------------------------------------------------------

async function addTodoItem(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const parentId = idOf(args, 'todo_ref', 'todo');
  const parent = await ownRow(env, 'tasks', parentId, 'todo');
  if (parent.parent_id) throw new TodoRefused('That is an item on a list already. Add the item to the todo it sits under.');
  const parsed = taskInput.shape.title.safeParse(text(args, 'title'));
  if (!parsed.success) throw new TodoRefused(parsed.error.issues[0].message);

  const after = await inserted(env, 'tasks', { user_id: env.userId, title: parsed.data, parent_id: parentId }, 'item');
  const id = after.id as string;
  const list = named(parent.title, 'the todo');
  const href = todoHref(parentId);
  return {
    kind: 'add_todo_item',
    input: { verb: 'Added', what: named(parsed.data, parsed.data), rest: ` to the list on ${list}`, href, where: 'Open in Todo', paths: TODO_PATHS },
    subjectRef: toRef('todo.tasks', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash added "${named(parsed.data, parsed.data)}" to the list on the todo "${list}".`,
    row: { table: 'todo.tasks', ref: id, title: named(parsed.data, parsed.data), href },
  };
}

// ---------------------------------------------------------------------------
// link_todo
// ---------------------------------------------------------------------------

/** What each target is called in a sentence. */
const TARGET_WORDS: Record<LinkTarget, string> = {
  application: 'an application',
  role: 'a role',
  company: 'a company',
  contact: 'a contact',
  interview: 'an interview',
  note: 'a vault note',
  order: 'an order',
  inventory: 'an item they own',
  saved: 'a saved item',
  reading: 'a reading',
  track: 'a reading list',
  subject: 'a Learn subject',
  goal: 'a goal or step',
  appointment: 'an appointment',
  story: 'a saved story',
};

/** Where each target's id is listed, for the tool's description. */
const TARGET_LOOKUPS =
  'application (job_search.applications), role (job_search.roles), company, contact, interview, note (obsidian.notes), order (public.orders), inventory (public.inventory_items), saved, reading (learn.readings), track (learn.tracks), subject, goal (goals.items, a goal or a step), appointment (todo.feed_events) or story (a saved news story)';

/** Refusals the link's trigger and keys give, in the words a person reads. */
function linkError(message: string): Error {
  if (message.includes('must point at something')) return new TodoRefused('That is not theirs to link to. Look it up first.');
  if (message.includes('violates foreign key')) return new TodoRefused('There is nothing with that ref to link to. Look it up first.');
  return new Error(`Linking the todo failed: ${message}`);
}

async function linkTodo(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const taskId = idOf(args, 'todo_ref', 'todo');
  const target = text(args, 'about');
  if (!isLinkTarget(target)) throw new TodoRefused(`about must be one of ${LINK_TARGETS.join(', ')}.`);
  const targetId = idOf(args, 'about_ref', TARGET_WORDS[target].replace(/^an? /, ''));
  const task = await ownRow(env, 'tasks', taskId, 'todo');
  const title = named(task.title, 'the todo');

  // Every target column cleared, then the one being set, as setTaskAbout does:
  // the check constraint wants exactly one, and a moved link must stop naming
  // what it named before.
  const columns: Row = {};
  for (const each of LINK_TARGETS) columns[TARGET_COLUMNS[each]] = null;
  for (const column of APPOINTMENT_COLUMNS) columns[column] = null;
  if (target === 'appointment') {
    // The calendar row is rewritten on every refresh, so the link keeps the appointment it copies.
    const ref = await appointmentRefFor(targetId, env.todo as TodoSupabaseClient);
    if (!ref) throw new TodoRefused('That appointment is no longer on the calendar.');
    Object.assign(columns, {
      feed_id: ref.feedId,
      feed_uid: ref.uid,
      feed_occurrence: ref.occurrence,
      feed_title: ref.title,
      feed_starts_on: ref.startsOn,
      feed_starts_at: ref.startsAt,
    });
  } else {
    columns[TARGET_COLUMNS[target]] = targetId;
  }

  // A todo is about one thing (task_links_about_key), so a second moves the one there.
  const { data: existing, error: readError } = await env.todo
    .from('task_links')
    .select('*')
    .eq('task_id', taskId)
    .eq('relation', 'about')
    .maybeSingle();
  if (readError) throw new Error(`Reading what the todo is about failed: ${readError.message}`);

  let before: Row | null = null;
  let after: Row;
  if (existing) {
    before = existing as Row;
    const { data, error } = await env.todo
      .from('task_links')
      .update(columns)
      .eq('id', before.id as string)
      .eq('task_id', taskId)
      .select('*')
      .single();
    if (error || !data) throw linkError(error?.message ?? 'no row');
    after = data as Row;
  } else {
    const { data, error } = await env.todo
      .from('task_links')
      .insert({ task_id: taskId, relation: 'about', ...columns })
      .select('*')
      .single();
    if (error || !data) throw linkError(error?.message ?? 'no row');
    after = data as Row;
  }

  const id = after.id as string;
  const href = todoHref(taskId);
  const what = TARGET_WORDS[target];
  return {
    kind: 'link_todo',
    input: { verb: 'Pointed', what: title, rest: ` at ${what}`, href, where: 'Open in Todo', paths: TODO_PATHS },
    subjectRef: toRef('todo.task_links', id),
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: `Dash said the todo "${title}" is about ${what}.`,
    row: { table: 'todo.tasks', ref: taskId, title, href },
  };
}

// ---------------------------------------------------------------------------
// add_event, change_event
// ---------------------------------------------------------------------------

const WHEN_KEYS = ['start_day', 'end_day', 'all_day', 'start_time', 'end_time'] as const;

/** "9:30" as the form sends it, "09:30"; empty stays empty. */
function clock(value: string): string {
  return value ? value.padStart(5, '0') : '';
}

/** The four columns for when an event is, from the arguments, or a refusal. */
function spanFrom(env: TodoWriteEnv, args: Args, title: string) {
  const parsed = eventInput.safeParse({
    title,
    body: '',
    location: '',
    allDay: args.all_day === true,
    startDay: text(args, 'start_day'),
    endDay: text(args, 'end_day'),
    startTime: clock(text(args, 'start_time')),
    endTime: clock(text(args, 'end_time')),
  });
  if (!parsed.success) throw new TodoRefused(parsed.error.issues[0].message);
  const { span, error } = resolveSpan(parsed.data, env.timezone);
  if (!span) throw new TodoRefused(error ?? 'That is not a time the calendar can hold.');
  return span;
}

/** Notes or a place, as the form keeps them: trimmed, and empty kept as nothing. */
function optional(args: Args, key: string, max: number, what: string): string | null {
  if (typeof args[key] !== 'string') throw new TodoRefused(`${key} must be text.`);
  const value = (args[key] as string).trim();
  if (value.length > max) throw new TodoRefused(`Keep the ${what} under ${max} characters.`);
  return value || null;
}

function eventDay(row: Row): string {
  const day = (row.starts_on as string | null) ?? (typeof row.starts_at === 'string' ? row.starts_at.slice(0, 10) : null);
  return day ?? '';
}

function calendarHref(day: string): string {
  return day ? `/todo/calendar?view=day&date=${day}` : '/todo/calendar';
}

function eventTitle(args: Args): string {
  const parsed = eventInput.shape.title.safeParse(text(args, 'title'));
  if (!parsed.success) throw new TodoRefused(parsed.error.issues[0].message);
  return parsed.data;
}

async function addEvent(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const title = eventTitle(args);
  const span = spanFrom(env, args, title);
  const after = await inserted(
    env,
    'events',
    {
      user_id: env.userId,
      title,
      body: sent(args, 'notes') ? optional(args, 'notes', 20_000, 'notes') : null,
      location: sent(args, 'location') ? optional(args, 'location', 500, 'place') : null,
      ...span,
    },
    'event',
  );
  const id = after.id as string;
  const day = eventDay(after);
  const href = calendarHref(day);
  const name = named(title, title);
  return {
    kind: 'add_event',
    input: { verb: 'Added', what: name, rest: ` to the calendar on ${day}`, href, where: 'Open the calendar', paths: ['/todo/calendar', '/todo'] },
    subjectRef: toRef('todo.events', id),
    op: 'insert',
    before: null,
    after,
    summary: `Dash added "${name}" to the calendar on ${day}.`,
    row: { table: 'todo.events', ref: id, title: name, href },
  };
}

async function changeEvent(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const id = idOf(args, 'event_ref', 'event');
  const before = await ownRow(env, 'events', id, 'event');
  const patch: Row = {};
  const said: string[] = [];

  let title = String(before.title ?? '');
  if (sent(args, 'title')) {
    title = eventTitle(args);
    if (title !== before.title) {
      patch.title = title;
      said.push(`renamed "${title}"`);
    }
  }
  if (WHEN_KEYS.some((key) => sent(args, key))) {
    if (!sent(args, 'start_day')) throw new TodoRefused('To move it, give start_day, and the times or all_day.');
    Object.assign(patch, spanFrom(env, args, title));
    said.push(`moved to ${text(args, 'start_day')}`);
  }
  if (sent(args, 'location')) {
    patch.location = optional(args, 'location', 500, 'place');
    said.push(patch.location ? 'its place set' : 'its place cleared');
  }
  if (sent(args, 'notes')) {
    patch.body = optional(args, 'notes', 20_000, 'notes');
    said.push(patch.body ? 'its notes written' : 'its notes cleared');
  }
  if (said.length === 0) throw new TodoRefused('Say what to change: title, when, location or notes.');

  const after = await updated(env, 'events', id, patch, 'event');
  const name = named(before.title, 'the event');
  const href = calendarHref(eventDay(after));
  return {
    kind: 'change_event',
    input: { verb: 'Changed', what: name, rest: `: ${listed(said)}`, href, where: 'Open the calendar', paths: ['/todo/calendar', '/todo'] },
    subjectRef: toRef('todo.events', id),
    op: 'update',
    before,
    after,
    summary: `Dash changed the event "${name}": ${listed(said)}.`,
    row: { table: 'todo.events', ref: id, title: named(after.title, name), href },
  };
}

// ---------------------------------------------------------------------------
// The definitions
// ---------------------------------------------------------------------------

const TODO_REF = { type: 'string', description: 'The todo.tasks ref todos, search or an earlier row returned for the todo.' } as const;
const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const TIME = { type: 'string', pattern: '^\\d{1,2}:\\d{2}$' } as const;

const WHEN_PROPERTIES = {
  start_day: { ...DAY, description: 'The day it starts, YYYY-MM-DD.' },
  end_day: { ...DAY, description: 'The day it ends, when that is not the day it starts.' },
  all_day: { type: 'boolean', description: 'True for an all-day event, with no times.' },
  start_time: { ...TIME, description: 'When it starts, HH:MM on their clock.' },
  end_time: { ...TIME, description: 'When it ends, HH:MM on their clock.' },
} as const;

/** The Todo writes, in the order a surface sends them. */
export const TODO_WRITES: readonly TodoWrite[] = [
  {
    name: 'edit_todo',
    description:
      "Change one of the person's todos in ways change_todo does not, when they ask: write or clear its notes, pin or unpin it, put it off for a week (later: true) or bring it back (later: false), drop it (state: dropped), or reopen one that is done or dropped (state: open). Send only what they asked to change. Renaming it, moving it to another day and ticking it off are not done with this tool.",
    input_schema: {
      type: 'object',
      properties: {
        todo_ref: TODO_REF,
        notes: { type: 'string', description: 'The notes on it, replacing what is there. Empty clears them.' },
        pinned: { type: 'boolean' },
        later: { type: 'boolean', description: 'True puts it out of sight for a week; false brings it back now.' },
        state: { type: 'string', enum: [...TODO_STATES], description: 'open reopens it; dropped drops it.' },
      },
      required: ['todo_ref'],
      additionalProperties: false,
    },
    run: editTodo,
  },
  {
    name: 'add_todo_item',
    description:
      'Add one item to the list on one of their todos, when they ask ("add milk to the shopping todo"). The item is ticked off with the todo. An item cannot hold a list of its own.',
    input_schema: {
      type: 'object',
      properties: {
        todo_ref: TODO_REF,
        title: { type: 'string', description: 'The item, in a short line.' },
      },
      required: ['todo_ref', 'title'],
      additionalProperties: false,
    },
    run: addTodoItem,
  },
  {
    name: 'link_todo',
    description: `Say what one of their todos is about, when they ask ("this todo is for the Stripe role"), so it shows on that row's page as well. A todo is about one thing: this replaces what it was about before. about is one of ${TARGET_LOOKUPS}; about_ref is that row's ref from a lookup.`,
    input_schema: {
      type: 'object',
      properties: {
        todo_ref: TODO_REF,
        about: { type: 'string', enum: [...LINK_TARGETS] },
        about_ref: { type: 'string', description: 'The ref a lookup returned for the row the todo is about.' },
      },
      required: ['todo_ref', 'about', 'about_ref'],
      additionalProperties: false,
    },
    run: linkTodo,
  },
  {
    name: 'add_event',
    description:
      "Add an event to the person's own calendar in Todo, when they ask (\"put lunch with Sam on Friday at 1\"). Give the day, and either both times or all_day. Calendars they subscribe to from elsewhere are not changed here.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The event, in a short line.' },
        ...WHEN_PROPERTIES,
        location: { type: 'string', description: 'Where it is, when they said.' },
        notes: { type: 'string', description: 'Notes on it, when they gave some.' },
      },
      required: ['title', 'start_day'],
      additionalProperties: false,
    },
    run: addEvent,
  },
  {
    name: 'change_event',
    description:
      "Change one event on the person's own calendar, when they ask: rename it, move it (give start_day again with the times or all_day), or set or clear its place or notes. Name it by the todo.events ref list_rows or an earlier row returned. Send only what changes.",
    input_schema: {
      type: 'object',
      properties: {
        event_ref: { type: 'string', description: 'The todo.events ref a lookup returned for the event.' },
        title: { type: 'string' },
        ...WHEN_PROPERTIES,
        location: { type: 'string', description: 'Its place; empty clears it.' },
        notes: { type: 'string', description: 'Its notes, replacing what is there; empty clears them.' },
      },
      required: ['event_ref'],
      additionalProperties: false,
    },
    run: changeEvent,
  },
];

/** Runs one Todo write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runTodoWrite(
  write: TodoWrite,
  env: TodoWriteEnv,
  input: unknown,
): Promise<TodoMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof TodoRefused) return { ok: false, error: error.message };
    console.error(`todo write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Todo writes as Ask's write tools, run on the person's own todo client. */
export const TODO_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = TODO_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('todo')) {
      return { ok: false, error: 'The Todo workspace is switched off, so nothing can be changed there.' };
    }
    const env = { userId: ctx.userId, todo: await ctx.db('todo'), timezone: ctx.timezone ?? 'UTC' };
    const made = await runTodoWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown>, undo: null };
  },
}));

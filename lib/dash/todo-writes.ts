import { sameAs, noButton, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskDb, type AskRow, type AskSchema, type SchemaClient } from '@/lib/ask/db';
import { loadAgendaItems, verbsOf } from '@/lib/ask/agenda';
import type { TodoChangeInput, TodoChangeKind } from '@/lib/ask/todo-changes';
import { toRef } from '@/lib/core/refs';
import { createEvent, eventInput, resolveSpan, updateEventFields, type EventFields, type EventWhen } from '@/lib/todo/events/write';
import { isLinkTarget, LINK_TARGETS, TARGET_COLUMNS, type LinkTarget } from '@/lib/todo/links/model';
import { setTaskAbout } from '@/lib/todo/links/write';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { taskInput } from '@/lib/todo/tasks/input';
import { addTaskTag, createItem, itemInput, reopenTaskWithItems, removeTaskTag, updateTaskFields, type TaskFields } from '@/lib/todo/tasks/write';
import { completeAgendaItem, deferAgendaItem, dismissAgendaItem } from '@/lib/todo/agenda/act';
import { clientsOver } from '@/lib/todo/agenda/clients';
import { sourceById } from '@/lib/todo/agenda/registry';
import { isSourceId, SOURCE_IDS, type AgendaSource, type SourceContext, type SourceId } from '@/lib/todo/agenda/sources';
import { todayIn } from '@/lib/todo/tasks/model';
import { dashTags } from '@/lib/todo/tasks/dash-tags';
import { dayIn } from '@/lib/todo/time';
import { TAGS_ADDED } from '@/lib/core/dash-actions';
import { LATER_REFUSED, LATER_UNTIL_HELP, laterUntil, untilWords } from '@/lib/core/snooze-days';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';
import { zoneDay } from '@/lib/core/when';
import { readSubject } from '@/lib/core/dash-actions';
import { namedItems } from '@/lib/ask/change-view';
import { asText, LISTABLE, listableSource, ownerColumn, viaTitle } from '@/lib/ask/list-rows';
import { rowsOfSet, SET_CAP } from './sets';

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
 *   change_agenda_row  a row another workspace put on the agenda finished,
 *                  put off or dismissed (plan #1894.9.2).
 *
 * Each is one row, inserted or updated, so the one undo rule in
 * lib/core/dash-actions.ts puts it back from the values kept (#1894.4: an
 * agent's writes go straight in, each listed on Home with an Undo).
 *
 * Each writes through the function its button on the Todo pages calls (plan
 * #2473.3, ./runs.ts), on the client it is given: updateTaskFields,
 * reopenTaskWithItems, addTaskTag and createItem in lib/todo/tasks/write.ts,
 * setTaskAbout in lib/todo/links/write.ts, createEvent and updateEventFields
 * in lib/todo/events/write.ts, and the agenda's verbs in
 * lib/todo/agenda/act.ts. What is checked here is what Dash needs beyond the
 * button: that the row is theirs, that the change says something, and the
 * words the model reads.
 *
 * Both Ask and the connector run them, as Learn's (lib/dash/learn-writes.ts):
 * Ask on the person's own todo client, the connector on a service-role one
 * for the verified person. The service role passes no row level security, so
 * every read and write here names the person's user id itself. A link's
 * target is checked by the database: task_links_target_is_owned refuses a
 * target that belongs to anyone but the todo's owner.
 */

/** Who the change is for, their todo client, and their zone for times of day. */
export type TodoWriteEnv = {
  userId: string;
  todo: SchemaClient;
  timezone: string;
  /** The person's client for any schema, for the agenda's rows in other workspaces. */
  db: AskDb;
};

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
  /** What undoing needs beyond the row: the tags Dash put on it (TAGS_ADDED). */
  undo?: Record<string, unknown> | null;
};

export type TodoWrite = {
  name: TodoChangeKind;
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
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

/** The person's todo client, as the lib writes take it. */
const todoClient = (env: TodoWriteEnv) => env.todo as unknown as TodoSupabaseClient;

/** The row a lib write gave back, or the failure it said. */
function written(result: { row: Row | null; error: string | null }, what: string): Row {
  if (result.error || !result.row) throw new Error(`Changing the ${what} failed: ${result.error ?? 'no row'}`);
  return result.row;
}

// ---------------------------------------------------------------------------
// edit_todo
// ---------------------------------------------------------------------------

const TODO_STATES = ['open', 'dropped'] as const;

async function editTodo(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const id = idOf(args, 'todo_ref', 'todo');
  const before = await ownRow(env, 'tasks', id, 'todo');
  const title = named(before.title, 'the todo');
  // The fields go through updateTaskFields, as the form, the pin, Later and
  // Drop do; reopening goes through reopenTaskWithItems, as the checkbox does.
  const fields: TaskFields = {};
  let reopening = false;
  const said: string[] = [];

  if (sent(args, 'notes')) {
    if (typeof args.notes !== 'string') throw new TodoRefused('notes must be text.');
    const parsed = taskInput.shape.body.safeParse(args.notes);
    if (!parsed.success) throw new TodoRefused('Keep the notes under 20,000 characters.');
    fields.body = parsed.data;
    said.push(parsed.data ? 'its notes written' : 'its notes cleared');
  }
  if (sent(args, 'pinned')) {
    const pinned = bool(args, 'pinned');
    fields.pinned = pinned;
    said.push(pinned ? 'pinned' : 'unpinned');
  }
  if (sent(args, 'later')) {
    // "Later" on the row, to a day from the one Later menu: out of sight
    // until it begins, still open, still due when it was. "back" brings it back.
    const choice = text(args, 'later');
    if (choice === 'back') {
      fields.snoozedUntil = null;
      said.push('brought back');
    } else {
      const later = laterUntil(choice, env.timezone);
      if (!later) throw new TodoRefused(`later must be ${LATER_UNTIL_HELP}, or back. ${LATER_REFUSED}`);
      fields.snoozedUntil = later.until;
      said.push(`put off ${untilWords(later.day, env.timezone)}`);
    }
  }
  if (sent(args, 'state')) {
    const state = text(args, 'state') as (typeof TODO_STATES)[number];
    if (!TODO_STATES.includes(state)) throw new TodoRefused(`state must be one of ${TODO_STATES.join(', ')}.`);
    if (before.status === state) throw new TodoRefused(`That todo is ${state} already.`);
    // The database stamps completed_at and dropped_at from the status.
    if (state === 'open') reopening = true;
    else fields.status = state;
    said.push(state === 'open' ? 'reopened' : 'dropped');
  }
  const asked = sent(args, 'tags');
  if (said.length === 0 && !asked) throw new TodoRefused('Say what to change: notes, pinned, later, state or tags.');

  // Tags go on a todo that has none (plan #2340.4): one the person tagged is
  // left as they tagged it. An open todo Dash edits is tagged by its date even
  // when no tags were sent; an item on a todo's list is not tagged unasked.
  const existing = await tagsOf(env, id);
  if (asked && existing.length > 0) {
    throw new TodoRefused(
      `That todo is tagged ${existing.join(', ')} already, and Dash leaves tags they set alone. Leave tags out, and tell them they can change its tags on its row.`,
    );
  }
  const status = reopening ? 'open' : ((fields.status ?? before.status) as string);
  const tagging = existing.length === 0 && (asked || (status === 'open' && !before.parent_id));
  let tags: string[] = [];
  if (tagging) {
    const due = typeof before.due_on === 'string' ? before.due_on : typeof before.due_at === 'string' ? dayIn(before.due_at, env.timezone) : null;
    const tagged = dashTags(args.tags, due, todayIn(env.timezone));
    if (!tagged.ok) throw new TodoRefused(tagged.error);
    tags = tagged.tags;
  }
  if (tags.length > 0) said.push(`tagged ${listed(tags)}`);
  if (said.length === 0) throw new TodoRefused('Say what to change: notes, pinned, later, state or tags.');

  // The tags first, so a failure there changes nothing; they come off again when the row's change fails.
  if (tags.length > 0) await addTags(env, id, tags);
  let after = before;
  try {
    if (Object.keys(fields).length > 0) {
      after = written(await updateTaskFields(env.userId, id, fields, env.timezone, todoClient(env)), 'todo');
    }
    if (reopening) {
      const { error } = await reopenTaskWithItems(env.userId, id, [], todoClient(env));
      if (error) throw new Error(`Reopening the todo failed: ${error}`);
      after = await ownRow(env, 'tasks', id, 'todo');
    }
  } catch (error) {
    if (tags.length > 0) await removeTags(env, id, tags);
    throw error;
  }
  const href = todoHref(id);
  return {
    kind: 'edit_todo',
    input: { verb: 'Changed', what: title, rest: `: ${listed(said)}`, href, where: 'Open in Todo', paths: TODO_PATHS },
    subjectRef: toRef('todo.tasks', id),
    op: 'update',
    before,
    after,
    summary: `Dash changed the todo "${title}": ${listed(said)}.`,
    row: { table: 'todo.tasks', ref: id, title, href, detail: { status: String(after.status), ...(tags.length > 0 ? { tags: tags.join(', ') } : {}) } },
    undo: tags.length > 0 ? { [TAGS_ADDED]: tags } : null,
  };
}

/** The tags on one of the person's todos; the task was read under their id first. */
async function tagsOf(env: TodoWriteEnv, taskId: string): Promise<string[]> {
  const { data, error } = await env.todo.from('task_tags').select('tag').eq('task_id', taskId);
  if (error) throw new Error(`Reading the todo's tags failed: ${error.message}`);
  return ((data ?? []) as { tag: string }[]).map((row) => row.tag);
}

/** Each tag through addTaskTag, as the tag picker does; all or none. */
async function addTags(env: TodoWriteEnv, taskId: string, tags: string[]): Promise<void> {
  const added: string[] = [];
  for (const tag of tags) {
    const { error } = await addTaskTag(env.userId, taskId, tag, todoClient(env));
    if (error) {
      await removeTags(env, taskId, added);
      throw new Error(`Tagging the todo failed: ${error}`);
    }
    added.push(tag);
  }
}

async function removeTags(env: TodoWriteEnv, taskId: string, tags: string[]): Promise<void> {
  for (const tag of tags) await removeTaskTag(env.userId, taskId, tag, todoClient(env));
}

// ---------------------------------------------------------------------------
// add_todo_item
// ---------------------------------------------------------------------------

async function addTodoItem(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const parentId = idOf(args, 'todo_ref', 'todo');
  const parent = await ownRow(env, 'tasks', parentId, 'todo');
  if (parent.parent_id) throw new TodoRefused('That is an item on a list already. Add the item to the todo it sits under.');
  const parsed = itemInput.shape.title.safeParse(text(args, 'title'));
  if (!parsed.success) throw new TodoRefused(parsed.error.issues[0].message);

  const made = await createItem(env.userId, parentId, { title: parsed.data }, todoClient(env));
  if (made.error || !made.row) throw new Error(`Adding the item failed: ${made.error ?? 'no row'}`);
  const after = made.row;
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

/** Refusals setTaskAbout gives (the link's trigger, its keys, a gone appointment), in the words the model reads. */
function linkError(message: string): Error {
  if (message.includes('not yours to link to') || message.includes('must point at something')) {
    return new TodoRefused('That is not theirs to link to. Look it up first.');
  }
  if (message.includes('violates foreign key')) return new TodoRefused('There is nothing with that ref to link to. Look it up first.');
  if (message.includes('no longer on the calendar')) return new TodoRefused('That appointment is no longer on the calendar.');
  return new Error(`Linking the todo failed: ${message}`);
}

async function aboutLink(env: TodoWriteEnv, taskId: string): Promise<Row | null> {
  const { data, error } = await env.todo.from('task_links').select('*').eq('task_id', taskId).eq('relation', 'about').maybeSingle();
  if (error) throw new Error(`Reading what the todo is about failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function linkTodo(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const taskId = idOf(args, 'todo_ref', 'todo');
  const target = text(args, 'about');
  if (!isLinkTarget(target)) throw new TodoRefused(`about must be one of ${LINK_TARGETS.join(', ')}.`);
  const targetId = idOf(args, 'about_ref', TARGET_WORDS[target].replace(/^an? /, ''));
  const task = await ownRow(env, 'tasks', taskId, 'todo');
  const title = named(task.title, 'the todo');

  // A todo is about one thing (task_links_about_key), so a second moves the
  // one there. setTaskAbout, which Point at on the row calls, clears every
  // target column and sets the one asked for, and keeps an appointment by
  // what it copies. The task was read under their id above, so the link is on
  // a todo of theirs; the trigger checks the target is theirs too.
  const before = await aboutLink(env, taskId);
  const { error } = await setTaskAbout(taskId, target, targetId, todoClient(env));
  if (error) throw linkError(error);
  const after = await aboutLink(env, taskId);
  if (!after) throw new Error('Linking the todo failed: no row');

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

/**
 * When an event is, from the arguments, parsed as the calendar's form is, or
 * a refusal. The write resolves it again; it is checked here so the model
 * reads why it was refused.
 */
function whenFrom(env: TodoWriteEnv, args: Args, title: string): EventWhen {
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
  const { allDay, startDay, endDay, startTime, endTime } = parsed.data;
  return { allDay, startDay, endDay, startTime, endTime };
}

/** Notes or a place, read as the calendar's form reads them: trimmed, and empty kept as nothing. */
function optional(args: Args, key: 'notes' | 'location', max: number, what: string): string | null {
  if (typeof args[key] !== 'string') throw new TodoRefused(`${key} must be text.`);
  const value = (args[key] as string).trim();
  if (value.length > max) throw new TodoRefused(`Keep the ${what} under ${max} characters.`);
  const parsed = eventInput.shape[key === 'notes' ? 'body' : 'location'].safeParse(value);
  if (!parsed.success) throw new TodoRefused(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * The day an event is on, in the person's zone. A timed event's start is
 * stored in UTC, so 8:30 pm in New York read as its first ten characters
 * was the next day ("Dinner with Sam" on 1 November was said to be on the
 * 2nd, and its link opened the 2nd).
 */
function eventDay(row: Row, timezone: string): string {
  if (typeof row.starts_on === 'string') return row.starts_on;
  return typeof row.starts_at === 'string' ? zoneDay(row.starts_at, timezone) : '';
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
  const when = whenFrom(env, args, title);
  const made = await createEvent(
    env.userId,
    {
      title,
      body: sent(args, 'notes') ? optional(args, 'notes', 20_000, 'notes') : null,
      location: sent(args, 'location') ? optional(args, 'location', 500, 'place') : null,
      ...when,
    },
    env.timezone,
    todoClient(env),
  );
  if (made.error || !made.row) throw new Error(`Adding the event failed: ${made.error ?? 'no row'}`);
  const after = made.row;
  const id = after.id as string;
  const day = eventDay(after, env.timezone);
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
  const fields: EventFields = {};
  const said: string[] = [];

  let title = String(before.title ?? '');
  if (sent(args, 'title')) {
    title = eventTitle(args);
    if (title !== before.title) {
      fields.title = title;
      said.push(`renamed "${title}"`);
    }
  }
  if (WHEN_KEYS.some((key) => sent(args, key))) {
    if (!sent(args, 'start_day')) throw new TodoRefused('To move it, give start_day, and the times or all_day.');
    fields.when = whenFrom(env, args, title);
    said.push(`moved to ${text(args, 'start_day')}`);
  }
  if (sent(args, 'location')) {
    fields.location = optional(args, 'location', 500, 'place');
    said.push(fields.location ? 'its place set' : 'its place cleared');
  }
  if (sent(args, 'notes')) {
    fields.body = optional(args, 'notes', 20_000, 'notes');
    said.push(fields.body ? 'its notes written' : 'its notes cleared');
  }
  if (said.length === 0) throw new TodoRefused('Say what to change: title, when, location or notes.');

  const after = written(await updateEventFields(env.userId, id, fields, env.timezone, todoClient(env)), 'event');
  const name = named(before.title, 'the event');
  const href = calendarHref(eventDay(after, env.timezone));
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
// change_agenda_row
// ---------------------------------------------------------------------------

const AGENDA_VERBS = {
  finish: { done: 'Finished', said: 'finished', cannot: 'finish' },
  put_off: { done: 'Put off', said: 'put off', cannot: 'put off' },
  dismiss: { done: 'Dismissed', said: 'dismissed', cannot: 'dismiss' },
} as const;
type AgendaVerb = keyof typeof AGENDA_VERBS;

/** The value of todo.dismissals.source each overlay-using source writes under. */
const DISMISSAL_SOURCE: Partial<Record<SourceId, string>> = {
  return_deadlines: 'return_deadline',
  goal_steps: 'goal_step',
  bills: 'recurring_payment',
  applications: 'application',
  plan_steps: 'plan_item',
  raised: 'raised_item',
  threads: 'thread',
};

/** The one row a verb changes, which is what the Undo puts back. */
type AgendaSubject = { schema: 'job_search' | 'core' | 'goals' | 'todo'; table: string; match: Record<string, string> };

/**
 * The row a source's verb writes. A job reminder and a draft carry the verb
 * on their own row; a goal step is closed on its own row; everything else
 * the agenda puts off or dismisses is an overlay row in todo.dismissals
 * (lib/todo/agenda/dismissals.ts).
 */
function agendaSubject(source: SourceId, verb: AgendaVerb, key: string): AgendaSubject {
  if (source === 'job_reminders') {
    return { schema: 'job_search', table: 'reminders', match: { id: key.slice('job_reminders:'.length) } };
  }
  if (source === 'job_waiting') {
    return {
      schema: 'job_search',
      table: 'waiting_dismissals',
      match: { application_event_id: key.slice('job_waiting:'.length) },
    };
  }
  if (source === 'drafts') {
    return { schema: 'core', table: 'drafted_messages', match: { id: key.slice('drafts:'.length) } };
  }
  if (source === 'goal_steps' && verb === 'finish') {
    return { schema: 'goals', table: 'items', match: { id: key.slice('goal_steps:'.length) } };
  }
  const overlay = DISMISSAL_SOURCE[source];
  if (!overlay) throw new TodoRefused('That row cannot be changed from here.');
  return { schema: 'todo', table: 'dismissals', match: { source: overlay, source_key: key } };
}

async function subjectRow(env: TodoWriteEnv, subject: AgendaSubject): Promise<Row | null> {
  const client = await env.db(subject.schema);
  let query = client.from(subject.table).select('*').eq('user_id', env.userId);
  for (const [column, value] of Object.entries(subject.match)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Reading the agenda row failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function changeAgendaRow(env: TodoWriteEnv, args: Args): Promise<TodoMade> {
  const sourceId = text(args, 'agenda_source');
  const key = text(args, 'agenda_key');
  const verbName = text(args, 'verb') as AgendaVerb;
  if (!isSourceId(sourceId)) throw new TodoRefused(`agenda_source must be one of ${SOURCE_IDS.join(', ')}, as the agenda lookup returned it.`);
  if (!key) throw new TodoRefused('agenda_key is missing: give the key the agenda lookup returned.');
  if (!(verbName in AGENDA_VERBS)) throw new TodoRefused('verb must be finish, put_off or dismiss.');
  const verb = AGENDA_VERBS[verbName];
  // Put off to a day from the one Later menu, read in their zone (plan #1957.9).
  const later = verbName === 'put_off' ? laterUntil(text(args, 'until'), env.timezone) : null;
  if (verbName === 'put_off' && !later) throw new TodoRefused(`until must be ${LATER_UNTIL_HELP}.`);
  const source = sourceById(sourceId) as AgendaSource;

  // The row has to be on the agenda now: that is what makes the key real and
  // names the row for the person. A forged key finds nothing here.
  const item = (await loadAgendaItems(env.userId, env.db)).find((each) => each.source === sourceId && each.key === key);
  if (!item) throw new TodoRefused('That row is not on their agenda now. Look at the agenda again.');
  const title = named(item.title, 'the row');
  if (!verbsOf(sourceId, item.completable).includes(verbName)) {
    throw new TodoRefused(`${source.label}: nothing here can ${verb.cannot} that.`);
  }
  if (sourceId === 'goal_steps' && verbName === 'finish' && key.startsWith('goal_suggestions:')) {
    // Whether they went is theirs to say; it also counts towards a rhythm on a second row.
    throw new TodoRefused('Whether they went to that is theirs to say. Put it off or dismiss it instead.');
  }

  const subject = agendaSubject(sourceId, verbName, key);
  const before = await subjectRow(env, subject);
  if (!before && subject.table !== 'dismissals' && subject.table !== 'waiting_dismissals') throw new TodoRefused('That row is not theirs to change.');

  const now = new Date();
  const today = todayIn(env.timezone, now);
  const ctx: SourceContext = { userId: env.userId, timezone: env.timezone, from: today, to: today, now, clients: clientsOver(env.db) };
  // The agenda's own verbs, as its Done, Later and Drop call them.
  const { error } = later
    ? await deferAgendaItem(ctx, sourceId, key, later.until)
    : verbName === 'finish'
      ? await completeAgendaItem(ctx, sourceId, key)
      : await dismissAgendaItem(ctx, sourceId, key);
  if (error) throw new TodoRefused(error);

  const after = await subjectRow(env, subject);
  if (!after) throw new Error('Changing the agenda row failed: the row is gone.');
  if (before && JSON.stringify(before) === JSON.stringify(after)) throw new TodoRefused('Nothing changed: it was already so.');

  const id = after.id as string;
  return {
    kind: 'change_agenda_row',
    input: { verb: verb.done, what: title, rest: ' on the Todo agenda', href: '/todo', where: 'Open Todo', paths: ['/todo', '/home'] },
    subjectRef: toRef(`${subject.schema}.${subject.table}`, id),
    op: before ? 'update' : 'insert',
    before,
    after,
    summary: `Dash ${verb.said} "${title}"${later ? ` ${untilWords(later.day, env.timezone)}` : ''} on the Todo agenda.`,
    row: {
      table: `${subject.schema}.${subject.table}`,
      ref: id,
      title,
      href: item.link?.href.startsWith('/') ? item.link.href : '/todo',
    },
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
    runs: sameAs(
      ['app/todo/actions.ts#editTask', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#reopenTask', 'lib/todo/tasks/write.ts#reopenTaskWithItems'],
      ['app/todo/actions.ts#dropTask', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#pinTask', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#laterTask', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#bringBackTask', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#tagTask', 'lib/todo/tasks/write.ts#addTaskTag'],
    ),
    description:
      "Change one of the person's todos in ways change_todo does not, when they ask: write or clear its notes, pin or unpin it, put it off to a day (later: tomorrow, weekend, next_week, next_month or a day) or bring it back (later: back), drop it (state: dropped), or reopen one that is done or dropped (state: open). Send only what they asked to change. Renaming it, moving it to another day and ticking it off are not done with this tool. An open todo with no tags is tagged as it is changed: now when it is due today or before, eventually when it has no date or one more than two weeks off. Send tags only for more: now for one they said they need today, and any tag they already use (the todos lookup lists them in tags_in_use) that clearly fits; never make up new ones. A todo that has tags already keeps them: do not send tags for it.",
    input_schema: {
      type: 'object',
      properties: {
        todo_ref: TODO_REF,
        notes: { type: 'string', description: 'The notes on it, replacing what is there. Empty clears them.' },
        pinned: { type: 'boolean' },
        later: { type: 'string', description: `Puts it out of sight until a day: ${LATER_UNTIL_HELP}. back brings it back now.` },
        state: { type: 'string', enum: [...TODO_STATES], description: 'open reopens it; dropped drops it.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for a todo that has none, beyond the one its date gives: lowercase, from the ones they already use.',
        },
      },
      required: ['todo_ref'],
      additionalProperties: false,
    },
    run: editTodo,
  },
  {
    name: 'add_todo_item',
    runs: sameAs(['app/todo/actions.ts#addItem', 'lib/todo/tasks/write.ts#createItem']),
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
    runs: sameAs(
      ['app/todo/actions.ts#pointTaskAt', 'lib/todo/links/write.ts#setTaskAbout'],
      ['app/todo/link-actions.ts#addLinkedTask', 'lib/todo/links/write.ts#linkTask'],
    ),
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
    runs: sameAs(['app/todo/calendar/actions.ts#addEvent', 'lib/todo/events/write.ts#createEvent']),
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
    runs: sameAs(['app/todo/calendar/actions.ts#editEvent', 'lib/todo/events/write.ts#updateEventFields']),
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
  {
    name: 'change_agenda_row',
    runs: sameAs(
      ['app/todo/source-actions.ts#completeItem', 'lib/todo/agenda/act.ts#completeAgendaItem'],
      ['app/todo/source-actions.ts#deferItem', 'lib/todo/agenda/act.ts#deferAgendaItem'],
      ['app/todo/source-actions.ts#dismissItem', 'lib/todo/agenda/act.ts#dismissAgendaItem'],
    ),
    description:
      "Finish, put off or dismiss a row another workspace has put on the person's Todo agenda, such as a job reminder, a goal step sent to Todo, a draft waiting to be sent or a return deadline, when they ask. Find it with the agenda lookup and pass its agenda_source and agenda_key; the verbs a row takes are listed in its can. Finish is not offered for a date such as a return deadline. Their own todos are not changed with this tool: use close_todo and edit_todo.",
    input_schema: {
      type: 'object',
      properties: {
        agenda_source: { type: 'string', enum: [...SOURCE_IDS], description: 'The agenda_source the agenda lookup returned.' },
        agenda_key: { type: 'string', description: 'The agenda_key the agenda lookup returned for the row.' },
        verb: { type: 'string', enum: Object.keys(AGENDA_VERBS), description: 'finish ticks it off, put_off moves it later, dismiss says not this one.' },
        until: { type: 'string', description: `For put_off, the day it comes back: ${LATER_UNTIL_HELP}.` },
      },
      required: ['agenda_source', 'agenda_key', 'verb'],
      additionalProperties: false,
    },
    run: changeAgendaRow,
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

// ---------------------------------------------------------------------------
// add_todos (plan #2472.4)
// ---------------------------------------------------------------------------

/** What add_todos fills with each row's name, and with a role's company. */
const ROW_NAME = /\{title\}/gi;
const COMPANY_NAME = /\{company\}/gi;

/** The link target each table's rows take, for the tables a todo can be about. */
const TARGET_OF_TABLE: Readonly<Record<string, Exclude<LinkTarget, 'appointment'>>> = {
  'job_search.applications': 'application',
  'job_search.roles': 'role',
  'job_search.companies': 'company',
  'job_search.contacts': 'contact',
  'job_search.interviews': 'interview',
  'obsidian.notes': 'note',
  'public.orders': 'order',
  'public.inventory_items': 'inventory',
  'public.saved_items': 'saved',
  'learn.readings': 'reading',
  'learn.tracks': 'track',
  'learn.subjects': 'subject',
  'goals.items': 'goal',
  'news.saved_stories': 'story',
};

/** One todo add_todos made, as its record keeps it for Undo to tell whether it was touched since. */
export type AddedTodo = { id: string; title: string; due_on: string | null; tags: string[]; link_id: string | null };

/** What the record keeps in `undo` for add_todos. */
export type AddedTodosUndo = { rows: AddedTodo[] };

/** A row of the set: its id, the name {title} takes, and for a role the company {company} takes. */
type SetRow = { id: string; name: string; company: string | null };

/** The tables whose rows have a company to name: a role, and an application by its role. */
const ROLE_TABLES = ['job_search.roles', 'job_search.applications'];

/**
 * The name each row in the set goes by, by its ref, read under the person's
 * id. An application is named by its role, since its own title column is its
 * next action, and a role or an application also carries its company.
 */
async function rowNames(ctx: DashWriteContext, table: string, refs: string[]): Promise<Map<string, SetRow>> {
  const source = listableSource(table);
  const owner = source ? ownerColumn(source) : null;
  if (!source || !owner) throw new TodoRefused(`${table} is not a table Dash can read.`);
  const refColumn = source.ref ?? 'id';
  const roleColumn = table === 'job_search.applications' ? ['role_id'] : table === 'job_search.roles' ? ['company_id'] : [];
  const plain = [...new Set([refColumn, 'id', source.title, ...roleColumn])];
  const select = source.titleVia ? [...plain, `${source.titleVia.embed}(${source.titleVia.column})`] : plain;
  const [schema, name] = table.split('.') as [AskSchema, string];
  const { data, error } = await (await ctx.db(schema)).from(name).select(select.join(', ')).eq(owner, ctx.userId).in(refColumn, refs);
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  const found = (data ?? []) as unknown as Row[];

  // A role's title and company, for a set of roles or of applications.
  const roles = new Map<string, { title: string | null; company: string | null }>();
  if (ROLE_TABLES.includes(table)) {
    const jobs = await ctx.db('job_search');
    const roleRows =
      table === 'job_search.roles'
        ? found
        : await readOwn(jobs, 'roles', 'id, title, company_id', ctx.userId, found.map((row) => row.role_id as string).filter(Boolean));
    const companies = await readOwn(jobs, 'companies', 'id, name', ctx.userId, roleRows.map((row) => row.company_id as string).filter(Boolean));
    const companyName = new Map(companies.map((row) => [row.id as string, asText(row.name)]));
    for (const role of roleRows) {
      roles.set(role.id as string, { title: asText(role.title), company: companyName.get(role.company_id as string) ?? null });
    }
  }

  const names = new Map<string, SetRow>();
  for (const row of found) {
    const ref = String(row[refColumn] ?? '');
    const role = roles.get((table === 'job_search.applications' ? row.role_id : row.id) as string);
    const title = role?.title ?? (source.titleVia ? viaTitle(row, source.titleVia) : null) ?? asText(row[source.title]);
    names.set(ref, { id: String(row.id ?? ref), name: named(title, 'that row'), company: role?.company ? named(role.company, role.company) : null });
  }
  return names;
}

async function readOwn(client: SchemaClient, table: string, select: string, userId: string, ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from(table).select(select).eq('user_id', userId).in('id', [...new Set(ids)]);
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return (data ?? []) as Row[];
}

/** The title with each row's name, and its company where it has one, filled in. */
function filled(template: string, row: SetRow): string {
  return template.replace(ROW_NAME, row.name).replace(COMPANY_NAME, row.company ?? row.name);
}

/**
 * One todo for each row a lookup matched (plan #2472.4, feature #2472): the
 * set names the rows, and the title can name each one ("Follow up with
 * {title}"). Every todo takes the checks add_todo's do, the same date and
 * tags, and is about its row where a todo can point at that table. All or
 * nothing: a todo that fails takes the ones already made back out.
 */
async function addTodos(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('todo')) {
    return { ok: false, error: 'The Todo workspace is switched off, so nothing can be changed there.' };
  }
  const set = rowsOfSet(ctx.seen, args.set, LISTABLE.map((source) => source.table));
  if (!set.ok) return set;
  const template = text(args, 'title');
  if (!template) throw new TodoRefused('title is missing: the todo as they would write it, with {title} where each row\'s name goes.');
  const target = TARGET_OF_TABLE[set.table] ?? null;
  if (template.search(COMPANY_NAME) >= 0 && !ROLE_TABLES.includes(set.table)) {
    throw new TodoRefused(`{company} names a role's company, and ${set.name} holds rows of ${set.table}. Use {title} for each row's name.`);
  }
  const naming = template.search(ROW_NAME) >= 0 || template.search(COMPANY_NAME) >= 0;
  if (!naming && !target && set.ids.length > 1) {
    throw new TodoRefused(`A todo cannot point at a row of ${set.table}, so put {title} in the title where each row's name goes, or they get ${set.ids.length} todos that read the same.`);
  }
  const dueOn = text(args, 'due_on') || null;
  if (dueOn) {
    const day = taskInput.shape.dueOn.safeParse(dueOn);
    if (!day.success || Number.isNaN(Date.parse(dueOn))) throw new TodoRefused('due_on is not a date.');
  }
  // Every todo Dash adds arrives tagged (plan #2340.4), all of these alike.
  const tagged = dashTags(args.tags, dueOn, ctx.today);
  if (!tagged.ok) throw new TodoRefused(tagged.error);

  const names = await rowNames(ctx, set.table, set.ids);
  const gone = set.ids.filter((ref) => !names.has(ref));
  if (gone.length > 0) {
    throw new TodoRefused(`${gone.length} of the rows in ${set.name} are not theirs or are not there any more, so no todos were added. Look them up again.`);
  }
  const planned = set.ids.map((ref) => {
    const row = names.get(ref)!;
    const parsed = taskInput.shape.title.safeParse(filled(template, row));
    if (!parsed.success) throw new TodoRefused(parsed.error.issues[0].message);
    return { row, title: parsed.data };
  });

  const todo = await ctx.db('todo');
  const made: AddedTodo[] = [];
  try {
    for (const each of planned) {
      const { id, error } = await ctx.createTask(
        ctx.userId,
        { title: each.title, body: null, dueOn, dueTime: null, pinned: false, tags: tagged.tags },
        ctx.timezone ?? 'UTC',
      );
      if (error || !id) throw new Error(`Adding the todo failed: ${error ?? 'no row'}`);
      const added: AddedTodo = { id, title: each.title, due_on: dueOn, tags: tagged.tags, link_id: null };
      made.push(added);
      if (target) {
        const { data, error: linkError } = await todo
          .from('task_links')
          .insert({ task_id: id, relation: 'about', [TARGET_COLUMNS[target]]: each.row.id })
          .select('id')
          .single();
        if (linkError || !data) throw new Error(`Linking the todo failed: ${linkError?.message ?? 'no row'}`);
        added.link_id = (data as { id: string }).id;
      }
    }
  } catch (error) {
    if (made.length > 0) {
      const { error: cleanup } = await todo.from('tasks').delete().eq('user_id', ctx.userId).in('id', made.map((row) => row.id));
      if (cleanup) console.error('add_todos: the todos made before the failure were kept', cleanup.message);
    }
    throw error;
  }

  const count = made.length;
  const titles = made.slice(0, 3).map((row) => `"${named(row.title, row.title)}"`);
  const firstRef = toRef('todo.tasks', made[0].id);
  const after = await readSubject(ctx.db, firstRef);
  const due = dueOn ? `, due ${dueOn}` : '';
  const tags = tagged.tags.length > 0 ? `, tagged ${listed(tagged.tags)}` : '';
  const href = '/todo/all';
  const undo: AddedTodosUndo = { rows: made };
  return {
    ok: true,
    kind: 'add_todos',
    input: {
      verb: 'Added',
      what: `${count} ${count === 1 ? 'todo' : 'todos'}`,
      rest: `${due}${tags}: ${namedItems(titles, count)}`,
      href,
      where: 'Open in Todo',
      paths: TODO_PATHS,
    } satisfies TodoChangeInput as unknown as Record<string, unknown>,
    subjectRef: firstRef,
    op: 'insert',
    before: null,
    after,
    undo: undo as unknown as Record<string, unknown>,
    summary: `Dash added ${count} ${count === 1 ? 'todo' : 'todos'}, one for each row of ${set.name}${due}${tags}: ${namedItems(titles, count)}.`,
    row: { table: 'todo.tasks', ref: made[0].id, title: `${count} ${count === 1 ? 'todo' : 'todos'}`, href },
  };
}

function addedUndo(value: Record<string, unknown> | null): AddedTodosUndo | null {
  const rows = value?.rows;
  if (!Array.isArray(rows)) return null;
  const ok = rows.every((r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.title === 'string' && Array.isArray(r.tags));
  return ok ? { rows: rows as AddedTodo[] } : null;
}

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Take out every todo an add_todos record made that is still as Dash left
 * it: open, not renamed, moved, written in, pinned, put off, retagged, given
 * items or linked to anything else. The ones they have touched since stay.
 * Refused only when none is left to take out.
 */
export async function undoAddedTodos(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number; ids: string[] } | { ok: false; error: string }> {
  const undo = addedUndo(recorded);
  if (!undo || undo.rows.length === 0) return { ok: false, error: 'Dash did not keep what this added, so it cannot be undone.' };
  const todo = await deps.db('todo');
  const ids = undo.rows.map((row) => row.id);
  const [tasks, items, links, tags] = await Promise.all([
    todo.from('tasks').select('id, title, body, status, due_on, due_at, pinned, snoozed_until').eq('user_id', deps.userId).in('id', ids),
    todo.from('tasks').select('parent_id').eq('user_id', deps.userId).in('parent_id', ids),
    todo.from('task_links').select('id, task_id').in('task_id', ids),
    todo.from('task_tags').select('task_id, tag').in('task_id', ids),
  ]);
  for (const read of [tasks, items, links, tags]) if (read.error) throw new Error(`Reading the todos failed: ${read.error.message}`);
  const byId = new Map(((tasks.data ?? []) as Row[]).map((row) => [row.id as string, row]));
  const withItems = new Set(((items.data ?? []) as Row[]).map((row) => row.parent_id as string));
  const linksOf = (id: string) => ((links.data ?? []) as Row[]).filter((row) => row.task_id === id).map((row) => row.id as string);
  const tagsOf = (id: string) => ((tags.data ?? []) as Row[]).filter((row) => row.task_id === id).map((row) => row.tag as string);

  const untouched = undo.rows.filter((made) => {
    const task = byId.get(made.id);
    if (!task || task.status !== 'open' || withItems.has(made.id)) return false;
    if (task.title !== made.title || (task.body ?? null) !== null || (task.due_on ?? null) !== made.due_on) return false;
    if ((task.due_at ?? null) !== null || task.pinned !== false || (task.snoozed_until ?? null) !== null) return false;
    const linked = linksOf(made.id);
    if (linked.length !== (made.link_id ? 1 : 0) || (made.link_id && linked[0] !== made.link_id)) return false;
    return sameTags(tagsOf(made.id), made.tags);
  });
  if (untouched.length === 0) {
    return { ok: false, error: 'Every one of those todos has been ticked off, edited or deleted since, so Dash left them as they are.' };
  }
  const { data, error } = await todo
    .from('tasks')
    .delete()
    .eq('user_id', deps.userId)
    .eq('status', 'open')
    .in('id', untouched.map((row) => row.id))
    .select('id');
  if (error) throw new Error(`Taking the todos out failed: ${error.message}`);
  const removed = ((data ?? []) as { id: string }[]).map((row) => row.id);
  if (removed.length === 0) return { ok: false, error: 'Those todos have changed since, so Dash left them as they are.' };
  return { ok: true, restored: removed.length, ids: removed };
}

/** How add_todos' tags are chosen, as add_todo says it. */
const ADD_TODOS_TAGS =
  'each is tagged now when due today or before, eventually when it has no date or one more than two weeks off; send tags only for more, from the ones they already use';

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

const ADD_TODOS_TOOL: DashWriteTool<DashWriteResult> = {
  name: 'add_todos',
  runs: noButton('One todo for each row a lookup matched, which no page offers: the Todo page adds them one at a time.'),
  kind: 'write',
  definition: {
    name: 'add_todos',
    description: `Add one todo for each row a lookup matched, when they ask for a todo per row ("add a todo to follow up on each of those leads"). Find the rows with query_rows first and pass the set it named; at most ${SET_CAP} rows. Write title as the todo would read, with {title} where each row's name goes ("Follow up with {title}"); for roles and applications, {company} is the role's company and {title} the role's title ("Email the recruiter at {company}"). Each todo is about its row, so it shows on that row's page, where a todo can point at the table; elsewhere {title} is needed. due_on and tags apply to every one, as on add_todo: ${ADD_TODOS_TAGS}. One Undo takes back every one they have not touched since. Say how many it added. Never call add_todo once per row for this. ${ASK_NOTE}`,
    input_schema: {
      type: 'object',
      properties: {
        set: { type: 'string', description: 'The name query_rows gave the rows it matched in this answer, such as "set 1".' },
        title: { type: 'string', description: 'The todo in a short line, with {title} where each row\'s name goes.' },
        due_on: { ...DAY, description: 'The day every one is due, YYYY-MM-DD, only when they named one.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags beyond the one the date gives: lowercase, from the ones they already use.' },
      },
      required: ['set', 'title'],
      additionalProperties: false,
    },
  },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Args) : {};
    try {
      return await addTodos(ctx, args);
    } catch (error) {
      if (error instanceof TodoRefused) return { ok: false, error: error.message };
      console.error('todo write add_todos failed', error);
      return { ok: false, error: 'Those todos could not be added. Tell them nothing was changed.' };
    }
  },
};

/** The Todo writes as Ask's write tools, run on the person's own todo client, and add_todos after them. */
export const TODO_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  ...TODO_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('todo')) {
      return { ok: false, error: 'The Todo workspace is switched off, so nothing can be changed there.' };
    }
    const env = { userId: ctx.userId, todo: await ctx.db('todo'), timezone: ctx.timezone ?? 'UTC', db: ctx.db };
    const made = await runTodoWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown>, undo: made.undo ?? null };
  },
  })),
  ADD_TODOS_TOOL,
];

import type Anthropic from '@anthropic-ai/sdk';
import { writeChange, type ChangeDeps } from '@/lib/ask/changes';
import { checkChange, type ProposalToolName } from '@/lib/ask/propose';
import { isUuid, type AskRow } from '@/lib/ask/db';
import { readSubject } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import { insertGoal } from '@/lib/goals/store';
import { parseGoalFields } from '@/lib/goals/tree';
import { setStepStatus } from '@/lib/goals/steps-store';
import type { ModuleId } from '@/lib/modules';
import type { DashChangeInput, DashChangeKind, NewDashChange } from '@/lib/talk/changes';
import { taskInput } from '@/lib/todo/tasks/input';
import { wallClockToInstant } from '@/lib/todo/time';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The changes Dash makes straight away when asked (plan #1440, feature
 * #1462; #1439 settled "straight away, with Undo"). Each is a write tool in
 * the registry: it checks the request against the person's rows, makes the
 * change through their own clients, and reports the row it touched with its
 * values before and after. The surface keeps that report as the record
 * (core.dash_actions), and the record is what Undo reads.
 *
 *   add_todo         a todo, with the day it is due.
 *   change_todo      a todo renamed, or moved to another day.
 *   close_todo       a todo ticked off, with the items on its list.
 *   add_goal         a goal under one of their areas.
 *   add_goal_step    a step at the end of a goal.
 *   close_goal_step  a step marked done.
 *   mark_returned    an owned item marked returned, with a full refund.
 *   add_role_note    a note on a role in Jobs.
 *
 * add_todo, add_goal_step and mark_returned were proposals the person
 * confirmed until now; they are checked by the same code (lib/ask/propose.ts)
 * and written by the writer Confirm used (lib/ask/changes.ts), so they read
 * and undo as before. A watch on a price stays a proposal: it reads a page
 * outside the app every hour and pushes to their phone, and anything that
 * acts outside the app waits for the person.
 *
 * A row is named by the ref a lookup returned for it, or the row the page
 * shows (`seen`), as citations are: Dash can only change a row it has seen.
 * An area is named by its name, since no lookup lists areas.
 */

const DONE_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

const TABLE = {
  task: 'todo.tasks',
  goalItem: 'goals.items',
  item: 'public.inventory_items',
  role: 'job_search.roles',
  application: 'job_search.applications',
  note: 'job_search.notes',
} as const;

const WORKSPACE_LABELS: Partial<Record<ModuleId, string>> = {
  todo: 'Todo',
  goals: 'Goals',
  shopping: 'Shopping',
  jobs: 'Jobs',
};

/** A refusal Dash reads and says in words. */
class Refused extends Error {}

type Args = Record<string, unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether the key was sent at all, so null can mean "clear it". */
function sent(args: Args, key: string): boolean {
  return key in args && args[key] !== undefined;
}

function requireWorkspace(ctx: DashWriteContext, module: ModuleId) {
  if (!ctx.enabledModules.includes(module)) {
    throw new Refused(`The ${WORKSPACE_LABELS[module] ?? module} workspace is switched off, so nothing can be changed there.`);
  }
}

/** A ref Dash has seen, in one of the tables it may be from. */
function seenRef(ctx: DashWriteContext, args: Args, key: string, tables: readonly string[]): { table: string; id: string } {
  const ref = text(args, key);
  if (!ref) throw new Refused(`${key} is missing.`);
  const table = tables.find((t) => ctx.seen(t, ref));
  if (!table || !isUuid(ref)) {
    throw new Refused(
      `No lookup in this conversation returned ${tables.join(' or ')} ${ref}. Look it up first and use the ref it gives.`,
    );
  }
  return { table, id: ref };
}

async function one<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

const todoHref = (id: string) => `/todo/all?status=all&focus=${id}`;

/** The day and time a todo is due, as the two columns hold them. */
function dueColumns(
  dueOn: string | null,
  dueTime: string | null,
  timezone: string,
): { due_on: string | null; due_at: string | null } {
  if (!dueOn) return { due_on: null, due_at: null };
  if (!dueTime) return { due_on: dueOn, due_at: null };
  return { due_on: null, due_at: wallClockToInstant(dueOn, dueTime, timezone) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

/** What every write reports, before the surface keeps it. */
type Made = Extract<DashWriteResult, { ok: true }>;

function made<K extends DashChangeKind>(
  kind: K,
  input: DashChangeInput[K],
  fields: Omit<Made, 'ok' | 'kind' | 'input'>,
): Made {
  return { ok: true, kind, input: input as Record<string, unknown>, ...fields };
}

// ---------------------------------------------------------------------------
// The three that were proposals
// ---------------------------------------------------------------------------

function changeDeps(ctx: DashWriteContext, core: ChangeDeps['core']): ChangeDeps {
  return {
    userId: ctx.userId,
    timezone: ctx.timezone ?? 'UTC',
    today: ctx.today,
    enabledModules: ctx.enabledModules,
    core,
    db: ctx.db,
    goals: ctx.goals,
    createTask: ctx.createTask,
  };
}

/** Checks the request as a proposal is checked, then writes it as Confirm did. */
async function writeAsConfirmed(
  ctx: DashWriteContext,
  proposal: ProposalToolName,
  input: unknown,
  report: (change: NewDashChange, ref: string) => { summary: string; row: AskRow },
): Promise<DashWriteResult> {
  const checked = await checkChange(proposal, input, ctx);
  if (!checked.ok) return checked;
  const change = checked.change;
  if (change.kind !== 'add_todo' && change.kind !== 'add_goal_step' && change.kind !== 'mark_returned') {
    return { ok: false, error: 'That change is proposed, not written.' };
  }
  const written = await writeChange(changeDeps(ctx, await ctx.db('core')), change);
  if (!written.ok) return written;
  const id = written.subjectRef.slice(written.subjectRef.indexOf(':') + 1);
  return {
    ok: true,
    kind: change.kind,
    input: change.input as Record<string, unknown>,
    subjectRef: written.subjectRef,
    op: written.op,
    before: written.before,
    after: written.after,
    undo: written.undo,
    ...report(change, id),
  };
}

async function addTodo(ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> {
  return writeAsConfirmed(ctx, 'propose_todo', input, (change, id) => {
    const todo = change.input as DashChangeInput['add_todo'];
    return {
      summary: `Dash added the todo "${todo.title}"${todo.dueOn ? `, due ${todo.dueOn}` : ''}.`,
      row: { table: TABLE.task, ref: id, title: todo.title, href: todoHref(id) },
    };
  });
}

async function addGoalStep(ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> {
  return writeAsConfirmed(ctx, 'propose_goal_step', input, (change, id) => {
    const step = change.input as DashChangeInput['add_goal_step'];
    return {
      summary: `Dash added the step "${step.title}" under the goal "${step.goalTitle}".`,
      row: { table: TABLE.goalItem, ref: id, title: step.title, href: `/goals/${step.parentId}#step-${id}` },
    };
  });
}

async function markReturned(ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> {
  return writeAsConfirmed(ctx, 'propose_returned', input, (change, id) => {
    const item = change.input as DashChangeInput['mark_returned'];
    return {
      summary: `Dash marked "${item.itemTitle}" returned, with a full refund at what it cost.`,
      row: { table: TABLE.item, ref: id, title: item.itemTitle, href: `/shopping/inventory/${id}` },
    };
  });
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_on: string | null;
  due_at: string | null;
  parent_id: string | null;
};

async function readTask(ctx: DashWriteContext, id: string): Promise<TaskRow> {
  const todo = await ctx.db('todo');
  const task = await one<TaskRow>(
    todo
      .from('tasks')
      .select('id, title, status, due_on, due_at, parent_id')
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .limit(1),
  );
  if (!task) throw new Refused('That todo is not one of theirs, or it has been deleted.');
  return task;
}

async function changeTodo(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'todo');
  const { id } = seenRef(ctx, args, 'todo_ref', [TABLE.task]);
  const renaming = sent(args, 'title');
  const moving = sent(args, 'due_on');
  if (!renaming && !moving) throw new Refused('Say what to change: a new title, a new due_on, or both.');

  const update: Record<string, unknown> = {};
  let title: string | null = null;
  if (renaming) {
    const parsed = taskInput.shape.title.safeParse(text(args, 'title'));
    if (!parsed.success) throw new Refused(parsed.error.issues[0].message);
    title = parsed.data;
    update.title = title;
  }
  let dueOn: string | null = null;
  let dueTime: string | null = null;
  if (moving) {
    dueOn = args.due_on === null ? null : text(args, 'due_on') || null;
    dueTime = text(args, 'due_time') || null;
    if (dueOn && (!DAY.test(dueOn) || Number.isNaN(Date.parse(dueOn)))) throw new Refused('due_on is not a date like 2026-03-10.');
    if (dueTime && !TIME.test(dueTime)) throw new Refused('due_time is not a time like 14:30.');
    if (dueTime && !dueOn) throw new Refused('A due_time needs a due_on.');
    if (dueTime) dueTime = dueTime.padStart(5, '0');
    Object.assign(update, dueColumns(dueOn, dueTime, ctx.timezone ?? 'UTC'));
  }

  const task = await readTask(ctx, id);
  if (task.status !== 'open') throw new Refused(`That todo is ${task.status} already, so it is not changed.`);
  const renamedFrom = title !== null && title !== task.title ? task.title : null;

  const ref = toRef(TABLE.task, id);
  const before = await readSubject(ctx.db, ref);
  const todo = await ctx.db('todo');
  const { data, error } = await todo.from('tasks').update(update).eq('id', id).eq('user_id', ctx.userId).select('id');
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new Refused('That todo could not be changed.');
  const after = await readSubject(ctx.db, ref);

  const now = title ?? task.title;
  const day = dueOn ? `${dueOn}${dueTime ? ` at ${dueTime}` : ''}` : null;
  const said = [
    renamedFrom ? `renamed the todo "${renamedFrom}" to "${now}"` : null,
    moving ? (day ? `moved ${renamedFrom ? 'it' : `the todo "${now}"`} to ${day}` : `took the due date off ${renamedFrom ? 'it' : `the todo "${now}"`}`) : null,
  ].filter(Boolean);
  return made(
    'change_todo',
    { id, title: now, renamedFrom, moved: moving, dueOn, dueTime },
    {
      subjectRef: ref,
      op: 'update',
      before,
      after,
      summary: `Dash ${said.length > 0 ? said.join(' and ') : `left the todo "${now}" as it was`}.`,
      row: { table: TABLE.task, ref: id, title: now, href: todoHref(id) },
    },
  );
}

async function closeTodo(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'todo');
  const { id } = seenRef(ctx, args, 'todo_ref', [TABLE.task]);
  const task = await readTask(ctx, id);
  if (task.status === 'done') throw new Refused('That todo is ticked off already.');
  if (task.status !== 'open') throw new Refused(`That todo is ${task.status}, so it is not ticked off.`);

  const todo = await ctx.db('todo');
  // Finishing a todo finishes the items on its list (#261), as the page does.
  const { data: open, error: openError } = await todo
    .from('tasks')
    .select('id')
    .eq('parent_id', id)
    .eq('user_id', ctx.userId)
    .eq('status', 'open');
  if (openError) throw new Error(openError.message);
  const items = ((open ?? []) as { id: string }[]).map((row) => row.id);

  const ref = toRef(TABLE.task, id);
  const before = await readSubject(ctx.db, ref);
  if (items.length > 0) {
    const { error } = await todo.from('tasks').update({ status: 'done' }).in('id', items).eq('user_id', ctx.userId);
    if (error) throw new Error(error.message);
  }
  const { data, error } = await todo
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new Refused('That todo changed while Dash was ticking it off.');
  const after = await readSubject(ctx.db, ref);

  return made(
    'close_todo',
    { id, title: task.title, items: items.length },
    {
      subjectRef: ref,
      op: 'update',
      before,
      after,
      // The items go back with the todo on Undo (lib/ask/changes.ts).
      undo: items.length > 0 ? { items } : null,
      summary: `Dash ticked off the todo "${task.title}"${items.length > 0 ? `, with the ${items.length === 1 ? 'item' : `${items.length} items`} on its list` : ''}.`,
      row: { table: TABLE.task, ref: id, title: task.title, href: todoHref(id) },
    },
  );
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

async function addGoal(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'goals');
  const parsed = parseGoalFields((key) => (key === 'title' ? text(args, 'title') : undefined), { requireTitle: true });
  if (!parsed.ok) throw new Refused(parsed.error);
  const title = parsed.value.title as string;
  const dueOn = text(args, 'due_on') || null;
  if (dueOn && (!DAY.test(dueOn) || Number.isNaN(Date.parse(dueOn)))) throw new Refused('due_on is not a date like 2026-03-10.');

  const wanted = text(args, 'area');
  if (!wanted) throw new Refused('area is missing: name the area the goal goes under.');
  const goals = await ctx.db('goals');
  const { data, error } = await goals
    .from('areas')
    .select('id, name')
    .eq('user_id', ctx.userId)
    .is('archived_at', null)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  const areas = (data ?? []) as { id: string; name: string }[];
  const key = wanted.toLowerCase();
  const area = areas.find((a) => a.id === wanted) ?? areas.find((a) => a.name.trim().toLowerCase() === key);
  if (!area) {
    const names = areas.map((a) => `"${a.name}"`).join(', ');
    throw new Refused(
      areas.length > 0
        ? `They have no area called "${wanted}". Their areas are ${names}: use one of those, or ask which they meant.`
        : 'They have no areas yet, so a goal has nowhere to go. Say so.',
    );
  }

  // Written on their session, not as Dash's: they asked for this goal, so it
  // goes in approved, as one they add on the page does (goals 0042). A goal
  // written as Dash's could only be a proposal.
  const client = await ctx.goals({});
  const id = await insertGoal(client, ctx.userId, area.id, { title, dueOn });
  if (!id) throw new Refused('That area has just been archived.');
  const ref = toRef(TABLE.goalItem, id);
  return made(
    'add_goal',
    { areaId: area.id, areaName: area.name, title, dueOn },
    {
      subjectRef: ref,
      op: 'insert',
      before: null,
      after: await readSubject(ctx.db, ref),
      summary: `Dash added the goal "${title}" under ${area.name}.`,
      row: { table: TABLE.goalItem, ref: id, title, href: `/goals/${id}` },
    },
  );
}

type GoalItemRow = { id: string; parent_id: string | null; level: string; title: string; status: string; archived_at: string | null };

async function closeGoalStep(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'goals');
  const { id } = seenRef(ctx, args, 'step_ref', [TABLE.goalItem]);
  const goals = await ctx.db('goals');
  const read = (itemId: string) =>
    one<GoalItemRow>(
      goals
        .from('items')
        .select('id, parent_id, level, title, status, archived_at')
        .eq('id', itemId)
        .eq('user_id', ctx.userId)
        .limit(1),
    );
  const step = await read(id);
  if (!step || step.archived_at) throw new Refused('That step is not one of theirs, or it has been archived.');
  if (step.level !== 'step') throw new Refused('That is a goal, not a step. Dash closes steps; a goal is closed on its page.');
  if (step.status === 'done') throw new Refused('That step is done already.');
  if (step.status === 'dropped') throw new Refused('That step was dropped, so it is not marked done.');
  if (step.status === 'proposed') throw new Refused('That step is still a proposal. They approve it on the goal first.');

  // The goal at the top of the branch, for the card and the link.
  let goal: GoalItemRow | null = null;
  let at = step.parent_id;
  for (let depth = 0; at && depth < 20; depth++) {
    const up = await read(at);
    if (!up) break;
    if (up.level === 'goal') {
      goal = up;
      break;
    }
    at = up.parent_id;
  }
  if (!goal) throw new Refused('Dash could not find the goal that step sits under.');

  const ref = toRef(TABLE.goalItem, id);
  const before = await readSubject(ctx.db, ref);
  let closed: boolean;
  try {
    closed = await setStepStatus(await ctx.goals({ actor: 'claude' }), id, 'done');
  } catch (error) {
    // The goals guard's refusals are sentences, such as a goal not yet approved.
    throw new Refused(`It could not be closed: ${error instanceof Error ? error.message : 'the database refused it'}`);
  }
  if (!closed) throw new Refused('That step changed while Dash was closing it.');
  const after = await readSubject(ctx.db, ref);
  return made(
    'close_goal_step',
    { id, title: step.title, goalId: goal.id, goalTitle: goal.title },
    {
      subjectRef: ref,
      op: 'update',
      before,
      after,
      summary: `Dash marked the step "${step.title}" done, under the goal "${goal.title}".`,
      row: { table: TABLE.goalItem, ref: id, title: step.title, href: `/goals/${goal.id}#step-${id}` },
    },
  );
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Longest note Dash writes on a role. */
export const ROLE_NOTE_MAX = 5000;

async function addRoleNote(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'jobs');
  const { table, id } = seenRef(ctx, args, 'role_ref', [TABLE.role, TABLE.application]);
  const body = text(args, 'body');
  if (!body) throw new Refused('body is missing: write the note.');
  if (body.length > ROLE_NOTE_MAX) throw new Refused(`Keep the note under ${ROLE_NOTE_MAX} characters.`);

  const jobs = await ctx.db('job_search');
  let roleId = id;
  if (table === TABLE.application) {
    const application = await one<{ role_id: string }>(
      jobs.from('applications').select('role_id').eq('id', id).eq('user_id', ctx.userId).limit(1),
    );
    if (!application) throw new Refused('That application is not one of theirs.');
    roleId = application.role_id;
  }
  const role = await one<{ id: string; title: string; companies: { name: string } | null }>(
    jobs.from('roles').select('id, title, companies ( name )').eq('id', roleId).eq('user_id', ctx.userId).limit(1),
  );
  if (!role) throw new Refused('That role is not one of theirs, or it has been deleted.');
  const roleTitle = `${role.title}${role.companies?.name ? ` at ${role.companies.name}` : ''}`;

  // Their note, written down for them: it reads as theirs on the role, and
  // the record says Dash wrote it.
  const { data, error } = await jobs
    .from('notes')
    .insert({ user_id: ctx.userId, role_id: roleId, author: 'me', body })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'The note was not written.');
  const noteId = (data as { id: string }).id;
  const ref = toRef(TABLE.note, noteId);
  return made(
    'add_role_note',
    { roleId, roleTitle, body },
    {
      subjectRef: ref,
      op: 'insert',
      before: null,
      after: await readSubject(ctx.db, ref),
      summary: `Dash added a note to the role ${roleTitle}.`,
      row: { table: TABLE.role, ref: roleId, title: roleTitle, href: `/jobs/roles/${roleId}` },
    },
  );
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

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

const DAY_PROP = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

function tool(
  name: DashChangeKind,
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

/** The write tools, in the order the model is sent them. */
export const WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  tool(
    'add_todo',
    "Add a todo to the person's list, when they ask you to.",
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The todo as they would write it, in a short line.' },
        due_on: { ...DAY_PROP, description: 'The day it is due, YYYY-MM-DD, only when they named one ("on Friday").' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    (ctx, args) => addTodo(ctx, args),
  ),
  tool(
    'change_todo',
    'Rename one of their open todos, or move it to another day, when they ask you to ("move the dentist to Friday"). Name it by the todo.tasks ref search or todos returned for it; look it up first. Send only what changes: title to rename it, due_on to move it (null takes the date off).',
    {
      type: 'object',
      properties: {
        todo_ref: { type: 'string', description: 'The todo.tasks ref a lookup returned for the todo.' },
        title: { type: 'string', description: 'Its new title, only when renaming.' },
        due_on: { anyOf: [DAY_PROP, { type: 'null' }], description: 'The new day it is due, YYYY-MM-DD; null to take the date off.' },
        due_time: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'A time on that day, HH:MM, only when they named one.' },
      },
      required: ['todo_ref'],
      additionalProperties: false,
    },
    changeTodo,
  ),
  tool(
    'close_todo',
    'Tick off one of their open todos, when they say it is done or ask you to. Name it by the todo.tasks ref a lookup returned; look it up first. The items on its list are ticked off with it.',
    {
      type: 'object',
      properties: { todo_ref: { type: 'string', description: 'The todo.tasks ref a lookup returned for the todo.' } },
      required: ['todo_ref'],
      additionalProperties: false,
    },
    closeTodo,
  ),
  tool(
    'add_goal',
    'Add a new goal under one of their areas, when they ask for one. Name the area by its name as they have it; if no area fits, ask which they mean instead of guessing. Only when they asked for a goal: a step under an existing goal is add_goal_step.',
    {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'The name of the area the goal goes under.' },
        title: { type: 'string', description: 'The goal, in a short line, as an outcome ("Run a half marathon").' },
        due_on: { ...DAY_PROP, description: 'The day it is due by, YYYY-MM-DD, only when they named one.' },
      },
      required: ['area', 'title'],
      additionalProperties: false,
    },
    addGoal,
  ),
  tool(
    'add_goal_step',
    "Add a step under one of the person's goals, when they ask you to. Name the goal by the ref goal_status or search returned for it in the goals.items table; look it up first. The step is theirs and goes last under the goal.",
    {
      type: 'object',
      properties: {
        goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
        title: { type: 'string', description: 'The step, in a short line.' },
      },
      required: ['goal_ref', 'title'],
      additionalProperties: false,
    },
    (ctx, args) => addGoalStep(ctx, args),
  ),
  tool(
    'close_goal_step',
    'Mark a step under one of their goals done, when they say it is done or ask you to. Name it by the goals.items ref search (kinds ["step"]) or goal_status returned for it; look it up first. A goal itself is not closed this way.',
    {
      type: 'object',
      properties: { step_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the step.' } },
      required: ['step_ref'],
      additionalProperties: false,
    },
    closeGoalStep,
  ),
  tool(
    'mark_returned',
    'Mark an item the person owns as returned, when they say they sent it back. Name it by the ref search returned for it in the public.inventory_items table; look it up first. It records a full refund at what the item cost.',
    {
      type: 'object',
      properties: {
        item_ref: { type: 'string', description: 'The public.inventory_items ref a lookup returned for the item.' },
      },
      required: ['item_ref'],
      additionalProperties: false,
    },
    (ctx, args) => markReturned(ctx, args),
  ),
  tool(
    'add_role_note',
    'Add a note to one of their roles in Jobs, when they ask you to note something on it ("note on the Stripe role that the recruiter is Sam"). Name the role by the job_search.roles ref search returned, or the job_search.applications ref applications returned; look it up first. Write the note in their words.',
    {
      type: 'object',
      properties: {
        role_ref: { type: 'string', description: 'The job_search.roles or job_search.applications ref a lookup returned.' },
        body: { type: 'string', description: 'The note, as they said it.' },
      },
      required: ['role_ref', 'body'],
      additionalProperties: false,
    },
    addRoleNote,
  ),
];

/** The names of the write tools, which are also the kinds their records carry. */
export const WRITE_TOOL_NAMES = WRITE_TOOLS.map((t) => t.name);

import { COMMENT_MAX } from '@/lib/goals/comments';
import { isRoleKind, ROLE_KINDS, type RoleKind } from '@/lib/jobs/role-kind';
import { sameAs, noButton, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { writeChange, type ChangeDeps } from '@/lib/ask/changes';
import { checkChange, taggedWords, type ProposalToolName } from '@/lib/ask/propose';
import { isUuid, type AskRow } from '@/lib/ask/db';
import { readSubject } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import { insertArea, insertGoal, updateGoal } from '@/lib/goals/store';
import { parseGoalFields } from '@/lib/goals/tree';
import { setStepStatus } from '@/lib/goals/steps-store';
import { MODULE_IDS, type ModuleId } from '@/lib/modules';
import type { DashChangeInput, DashChangeKind, NewDashChange } from '@/lib/talk/changes';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { completeTaskWithItems, renameInput, rescheduleInput, updateTaskFields, type TaskFields } from '@/lib/todo/tasks/write';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';
import { addThreadTurn } from '@/lib/thread/store';
import { stepHref } from '@/lib/goals/all-goals';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { detectPosting, isBoardVendor } from '@/lib/jobs/ats/detect';
import { companyFromBoardToken } from '@/lib/jobs/ats/company';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { BULK_MAX, changeItems, ITEM_CHANGES } from './bulk-items';
import { DISPOSAL_METHODS } from '@/lib/inventory/status-actions';
import { moveRoles, ROLE_STAGES } from './bulk-roles';
import { insertIdea } from '@/lib/ideas/insert';
import { createCapturedNote } from '@/lib/vault/notes/create';
import { noteHref } from '@/lib/vault/paths';
import { LEARN_WRITE_TOOLS } from './learn-writes';
import { TODO_WRITE_TOOLS } from './todo-writes';
import { YOU_WRITE_TOOLS } from './you-writes';
import { NEWS_WRITE_TOOLS } from './news-writes';
import { GOALS_WRITE_TOOLS } from './goals-writes';
import { SHOPPING_WRITE_TOOLS } from './shopping-writes';
import { VAULT_WRITE_TOOLS } from './vault-writes';
import { JOBS_WRITE_TOOLS } from './jobs-writes';
import { INTERVIEW_WRITE_TOOLS } from './interview-writes';
import { POST_WRITE_TOOLS } from './post-writes';
import { MODEL_WRITE_TOOLS } from './model-writes';

/**
 * The changes Dash makes straight away when asked (plan #1440, feature
 * #1462; #1439 settled "straight away, with Undo"). Each is a write tool in
 * the registry: it checks the request against the person's rows, makes the
 * change through their own clients, and reports the row it touched with its
 * values before and after. The surface keeps that report as the record
 * (core.dash_actions), and the record is what Undo reads.
 *
 *   add_todo         a todo, with the day it is due, tagged now or
 *                    eventually by that day (plan #2340.4).
 *   change_todo      a todo renamed, or moved to another day.
 *   close_todo       a todo ticked off, with the items on its list.
 *   add_goal         a goal under one of their areas.
 *   add_goal_step    a step at the end of a goal.
 *   close_goal_step  a step marked done.
 *   set_goal_done_when  a goal's done-when written, changed or cleared.
 *   mark_returned    an owned item marked returned, with a full refund.
 *   add_role_note    a note on a role in Jobs.
 *   add_idea         an idea on the ideas page in Dev.
 *   add_job_lead     a role saved as a lead in Jobs, from a posting link or
 *                    a title and company.
 *   change_items     many owned items marked for sale or to return, taken
 *                    off either, grouped, ungrouped, separated or disposed
 *                    of, with one Undo (lib/dash/bulk-items.ts, plans #1656
 *                    and #1894.5.1).
 *   move_roles       many job roles moved to one stage or archived, each
 *                    through the board's own move, with one Undo
 *                    (lib/dash/bulk-roles.ts, plan #1657).
 *   add_quick_note   a quick note in the vault's Inbox, the one the Vault
 *                    page's quick note box writes (plan #1894.2).
 *   Learn's six      a reading, a reading list, an idea or a video changed
 *                    or added (lib/dash/learn-writes.ts, plan #1894.8).
 *   Todo's five      a todo's notes, pin, snooze or state, an item on its
 *                    list, what it is about, and a calendar event added or
 *                    changed (lib/dash/todo-writes.ts, plan #1894.9.1).
 *   News's four and stop_watch  an issue marked unread, a story saved or
 *                    unsaved, sent to Learn or made a todo, and a price
 *                    watch stopped (lib/dash/news-writes.ts, plan #1894.9.4).
 *   Goals' seven     an area added, renamed, noted, moved or archived, a
 *                    goal edited, moved, archived, closed, parked or
 *                    reopened (lib/dash/goals-writes.ts, plan #1894.7.1),
 *                    and a step edited, dropped, reopened, blocked, moved,
 *                    archived, linked or made to wait (plan #1894.7.2),
 *                    and a goal's measure, links or step form changed
 *                    (plan #1894.7.3), and a Goals Inbox row snoozed or
 *                    an event's going recorded (plan #1894.7.4).
 *   You's two        a place they have lived added or changed
 *                    (lib/dash/you-writes.ts, plan #1991.5).
 *   Shopping's       change_item (one item's name, variant, notes, group
 *                    name or sell price) and item_lists (items on or off a
 *                    list, a list made or renamed), in
 *                    lib/dash/shopping-writes.ts (plan #1894.5.1).
 *   The Vault's six and change_course  a note written, edited, renamed or
 *                    filed from the Inbox, a theme or a Maya question
 *                    renamed, and a course corrected (lib/dash/vault-writes.ts,
 *                    plan #1894.9.3).
 *   Jobs' eight      a role's fields or company, and an application's
 *                    excitement or channel (lib/dash/jobs-writes.ts, plan
 *                    #1894.6.1); a company's name or details, and duplicate
 *                    roles merged (plan #1894.6.2); a reminder finished,
 *                    put off, edited or linked to an email, and a waiting
 *                    row finished or put off (plan #1894.6.3); an
 *                    application confirmed or reopened, and flagged events
 *                    acknowledged or flagged again, from Jobs review (plan
 *                    #1894.6.4.1); emails in Jobs review dismissed or
 *                    brought back (plan #1894.6.4.2); a new role made from
 *                    an email in Jobs review (plan #1894.6.4.3).
 *   add_interview_round  a round on a role, with its first interview
 *                    (lib/dash/interview-writes.ts, plan #2044.1).
 *   set_dash_model   the model Dash answers with switched to Haiku, Sonnet or
 *                    Opus, through the picker's own save (lib/dash/model-writes.ts,
 *                    plan #2458.4).
 *   rewrite_post     the text of a post draft on the Posts tab in Dev
 *                    rewritten (lib/dash/post-writes.ts, plan #2202.1).
 *   suggest_post     a new post draft saved to the Posts tab, with an
 *                    optional gallery picture (plan #2384.3).
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
  idea: 'public.ideas',
  note: 'obsidian.notes',
  // A note on a role is a turn in the role's thread (plan #1470).
  roleNote: 'core.conversation_turns',
} as const;

const WORKSPACE_LABELS: Partial<Record<ModuleId, string>> = {
  todo: 'Todo',
  goals: 'Goals',
  shopping: 'Shopping',
  jobs: 'Jobs',
  vault: 'Vault',
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

function requireWorkspace(ctx: Pick<DashWriteContext, 'enabledModules'>, module: ModuleId) {
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

/** The person's todo client, as lib/todo/tasks/write.ts takes it. */
async function todoClient(ctx: DashWriteContext): Promise<TodoSupabaseClient> {
  return (await ctx.db('todo')) as unknown as TodoSupabaseClient;
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
      summary: `Dash added the todo "${todo.title}"${todo.dueOn ? `, due ${todo.dueOn}` : ''}${taggedWords(todo.tags)}.`,
      row: { table: TABLE.task, ref: id, title: todo.title, href: todoHref(id) },
    };
  });
}

async function addGoalStep(ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> {
  return writeAsConfirmed(ctx, 'propose_goal_step', input, (change, id) => {
    const step = change.input as DashChangeInput['add_goal_step'];
    return {
      summary: `Dash added the step "${step.title}" under the goal "${step.goalTitle}".`,
      row: { table: TABLE.goalItem, ref: id, title: step.title, href: stepHref(step.parentId, id) },
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

  // The same write the form, the row's rename and its reschedule make (plan #2473.3).
  const fields: TaskFields = {};
  let title: string | null = null;
  if (renaming) {
    const parsed = renameInput.safeParse({ title: text(args, 'title') });
    if (!parsed.success) throw new Refused(parsed.error.issues[0].message);
    title = parsed.data.title;
    fields.title = title;
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
    const parsed = rescheduleInput.safeParse({ dueOn: dueOn ?? '', dueTime: dueTime ?? '' });
    if (!parsed.success) throw new Refused(parsed.error.issues[0].message);
    fields.due = parsed.data;
  }

  const task = await readTask(ctx, id);
  if (task.status !== 'open') throw new Refused(`That todo is ${task.status} already, so it is not changed.`);
  const renamedFrom = title !== null && title !== task.title ? task.title : null;

  const ref = toRef(TABLE.task, id);
  const before = await readSubject(ctx.db, ref);
  const { row, error } = await updateTaskFields(ctx.userId, id, fields, ctx.timezone ?? 'UTC', await todoClient(ctx));
  if (error) throw new Error(error);
  if (!row) throw new Refused('That todo could not be changed.');
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

  // Finishing a todo finishes the items on its list (#261), through the
  // function the checkbox calls (plan #2473.3), which says which it ticked.
  const ref = toRef(TABLE.task, id);
  const before = await readSubject(ctx.db, ref);
  const { items, error } = await completeTaskWithItems(ctx.userId, id, await todoClient(ctx));
  if (error) throw new Error(error);
  const after = await readSubject(ctx.db, ref);
  if (after?.status !== 'done') throw new Refused('That todo could not be ticked off.');

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
  const found = areas.find((a) => a.id === wanted) ?? areas.find((a) => a.name.trim().toLowerCase() === key);
  if (!found && args.new_area !== true) {
    const names = areas.map((a) => `"${a.name}"`).join(', ');
    throw new Refused(
      areas.length > 0
        ? `They have no area called "${wanted}". Their areas are ${names}: use the one that fits, or call add_goal again with new_area true to make "${wanted}".`
        : `They have no areas yet. Call add_goal again with new_area true to make "${wanted}".`,
    );
  }

  // Written on their session, not as Dash's: they asked for this goal, so it
  // goes in approved, as one they add on the page does (goals 0042). A goal
  // written as Dash's could only be a proposal. A new area is made the same
  // way when none of theirs fits; Undo takes the goal back and leaves the
  // area, which they archive on /goals if they do not want it.
  const client = await ctx.goals({});
  const areaMade = !found;
  const area = found ?? { id: await insertArea(client, ctx.userId, wanted), name: wanted };
  const id = await insertGoal(client, ctx.userId, area.id, { title, dueOn });
  if (!id) throw new Refused('That area has just been archived.');
  const ref = toRef(TABLE.goalItem, id);
  return made(
    'add_goal',
    { areaId: area.id, areaName: area.name, areaMade, title, dueOn },
    {
      subjectRef: ref,
      op: 'insert',
      before: null,
      after: await readSubject(ctx.db, ref),
      summary: areaMade
        ? `Dash added the area ${area.name} and the goal "${title}" under it.`
        : `Dash added the goal "${title}" under ${area.name}.`,
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
      row: { table: TABLE.goalItem, ref: id, title: step.title, href: stepHref(goal.id, id) },
    },
  );
}

/**
 * A goal's done-when, set when they ask for it by name (notes 06d36ab2,
 * fa2ac6fe). Written on their session, as add_goal is: goals.items_claude_guard
 * refuses a done-when change made as Dash's, which is right for a run deciding
 * on its own and wrong for the person asking in their own words.
 */
async function setGoalDoneWhen(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'goals');
  const { id } = seenRef(ctx, args, 'goal_ref', [TABLE.goalItem]);
  const parsed = parseGoalFields((key) => (key === 'acceptance' ? text(args, 'done_when') : undefined));
  if (!parsed.ok) throw new Refused(parsed.error);
  const doneWhen = parsed.value.acceptance ?? null;

  const goals = await ctx.db('goals');
  const goal = await one<{ id: string; level: string; title: string; acceptance: string | null; archived_at: string | null }>(
    goals
      .from('items')
      .select('id, level, title, acceptance, archived_at')
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .limit(1),
  );
  if (!goal || goal.archived_at) throw new Refused('That goal is not one of theirs, or it has been archived.');
  if (goal.level !== 'goal') throw new Refused('That is a step, not a goal. Only a goal has a done-when.');
  if ((goal.acceptance ?? null) === doneWhen) throw new Refused('That goal already has that done-when.');

  const ref = toRef(TABLE.goalItem, id);
  const before = await readSubject(ctx.db, ref);
  if (!(await updateGoal(await ctx.goals({}), id, { acceptance: doneWhen }))) {
    throw new Refused('That goal changed while Dash was writing its done-when.');
  }
  return made(
    'set_goal_done_when',
    { id, title: goal.title, doneWhen, previous: goal.acceptance ?? null },
    {
      subjectRef: ref,
      op: 'update',
      before,
      after: await readSubject(ctx.db, ref),
      summary: doneWhen
        ? `Dash set the done-when of "${goal.title}" to "${doneWhen}".`
        : `Dash cleared the done-when of "${goal.title}".`,
      row: { table: TABLE.goalItem, ref: id, title: goal.title, href: `/goals/${id}` },
    },
  );
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Longest note Dash writes on a role: the role page's comment box takes no more. */
export const ROLE_NOTE_MAX = COMMENT_MAX;

async function addRoleNote(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'jobs');
  const { table, id } = seenRef(ctx, args, 'role_ref', [TABLE.role, TABLE.application]);
  return noteOnRole(ctx, table, id, text(args, 'body'));
}

/** What writing a note on a role needs: the person, their workspaces and their clients. */
export type RoleNoteContext = Pick<DashWriteContext, 'userId' | 'enabledModules' | 'db'>;

/**
 * The add_role_note write for a role already known to be theirs by id, for
 * the capture box (plan #1581), which names the role from the sorter's list
 * of their roles rather than from a lookup. Checked and written exactly as
 * the tool writes it. Never throws.
 */
export async function writeRoleNote(
  ctx: RoleNoteContext,
  roleId: string,
  body: string,
): Promise<DashWriteResult> {
  try {
    requireWorkspace(ctx, 'jobs');
    if (!isUuid(roleId)) throw new Refused('Could not tell which role that was.');
    return await noteOnRole(ctx, TABLE.role, roleId, body.trim());
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    console.error('dash write add_role_note failed', error);
    return { ok: false, error: 'The note could not be added. Nothing was changed.' };
  }
}

async function noteOnRole(
  ctx: RoleNoteContext,
  table: string,
  id: string,
  body: string,
): Promise<DashWriteResult> {
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

  // Their note, written down for them in the role's thread: it reads as
  // theirs on the role, and the record says Dash wrote it.
  const noteId = await addThreadTurn(await ctx.db('core'), {
    userId: ctx.userId,
    ref: toRef(TABLE.role, roleId),
    author: 'me',
    body,
  });
  const ref = toRef(TABLE.roleNote, noteId);
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

/** Longest title a lead is saved with; a posting's own title is far shorter. */
const LEAD_TITLE_MAX = 300;

/**
 * Save a job as a lead: a role, its company (found or made, as every other
 * path does it), and an application in the lead state with nothing
 * submitted, the shape "Save as lead" on the roles page writes. The posting
 * is read from its link where a board or the page allows it, which fills
 * whatever title Dash was not given; the role's page fetches the
 * description later, as it does for a saved recommendation. Undo takes the
 * role back, and the application with it, while nothing has been added to
 * either; the company stays.
 */
async function addJobLead(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const priority = text(args, 'company_priority') || null;
  if (priority && !(COMPANY_PRIORITIES as readonly string[]).includes(priority)) {
    throw new Refused(`company_priority must be one of: ${COMPANY_PRIORITIES.join(', ')}.`);
  }
  const kind = text(args, 'kind') || null;
  if (kind && !isRoleKind(kind)) throw new Refused(`kind must be one of: ${ROLE_KINDS.join(', ')}.`);
  return saveJobLead(ctx, {
    url: text(args, 'url') || null,
    title: text(args, 'title'),
    company: text(args, 'company'),
    companyPriority: priority as CompanyPriority | null,
    kind: kind as RoleKind | null,
  });
}

/** How much they want to work at a company, as the companies page sets it. */
const COMPANY_PRIORITIES = ['target', 'interested', 'backup', 'passed'] as const;
type CompanyPriority = (typeof COMPANY_PRIORITIES)[number];

/** What saving a lead needs: the person, their workspaces, their clients and a way to read a posting. */
export type JobLeadContext = Pick<DashWriteContext, 'userId' | 'enabledModules' | 'db' | 'readPosting'>;

/**
 * The add_job_lead write for capture's Add a role (plan #1950.4): the same
 * checks, the same reading of the link and the same rows, from a link or a
 * title and company the capture field named. Never throws.
 */
export async function writeJobLead(
  ctx: JobLeadContext,
  input: { url: string | null; title: string; company: string },
): Promise<DashWriteResult> {
  try {
    return await saveJobLead(ctx, input);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: leadRefusalForPerson(error.message) };
    console.error('dash write add_job_lead failed', error);
    return { ok: false, error: 'The role could not be saved. Nothing was changed.' };
  }
}

/**
 * The refusals add_job_lead words for the model, said to the person instead:
 * capture shows them under the field, where there is no one to ask them.
 */
function leadRefusalForPerson(message: string): string {
  if (message.startsWith('That posting is saved already')) {
    const title = message.match(/as the role "([^"]+)"/)?.[1];
    return title ? `That posting is saved already, as ${title}.` : 'That posting is saved already.';
  }
  if (message.startsWith('The posting at that link could not be read')) {
    return 'The posting at that link could not be read. Add the role and the company after it, such as Analyst at Ramp.';
  }
  if (message.startsWith('The company is missing')) {
    return 'Dash could not tell the company from that link. Add it after the link, such as at Ramp.';
  }
  return message;
}

async function saveJobLead(
  ctx: JobLeadContext,
  input: { url: string | null; title: string; company: string; companyPriority?: CompanyPriority | null; kind?: RoleKind | null },
): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'jobs');
  const url = input.url?.trim() || null;
  let title = input.title.trim();
  let companyName = input.company.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Refused('url is not a web link starting http:// or https://.');
  if (!url && (!title || !companyName)) {
    throw new Refused('Give the posting link, or the role title and the company. Ask them for whichever is missing.');
  }

  const jobs = await ctx.db('job_search');
  if (url) {
    const saved = await one<{ id: string; title: string }>(
      jobs.from('roles').select('id, title').eq('user_id', ctx.userId).eq('jd_url', url).limit(1),
    );
    if (saved) throw new Refused(`That posting is saved already, as the role "${saved.title}" (job_search.roles ${saved.id}).`);
  }

  let location: string | null = null;
  let atsJobId: string | null = null;
  if (url && (!title || !companyName)) {
    const read = ctx.readPosting ?? (await import('@/lib/jobs/ats')).fetchPostingFromUrl;
    const outcome = await read(url).catch(() => null);
    if (outcome?.ok) {
      // What they told Dash outranks the page; the page fills what is missing,
      // the employer from its JobPosting data, site name, title or domain.
      if (!title) {
        title = outcome.posting.title.trim();
        location = outcome.posting.location;
        atsJobId = outcome.posting.atsJobId;
      }
      if (!companyName) companyName = outcome.posting.company?.trim() ?? '';
    }
    // A board's API leaves the employer out, and its slug in the link names it.
    if (!companyName) {
      const board = detectPosting(url);
      if (isBoardVendor(board.vendor)) companyName = companyFromBoardToken(board.boardToken) ?? '';
    }
  }
  if (!title) {
    throw new Refused(
      'The posting at that link could not be read for its title. Ask them for the role title (and the company, if you do not know it), then call add_job_lead again with the link.',
    );
  }
  if (!companyName) {
    throw new Refused(`The company is missing. Ask them which company "${title}" is at, then call add_job_lead again with the link.`);
  }
  if (title.length > LEAD_TITLE_MAX) title = title.slice(0, LEAD_TITLE_MAX).trimEnd();

  const detected = url ? detectPosting(url) : null;
  const vendor = detected?.vendor;
  const company = await ensureCompany(jobs as unknown as AppSupabaseClient, ctx.userId, companyName, {
    careersUrl: url,
    boardToken: detected?.boardToken ?? null,
    ats: !vendor || vendor === 'other' || vendor === 'unknown' ? null : vendor,
  });
  if (company.error) throw new Error(company.error);
  // Marking the company (a target, say) is the company's, so the role's Undo leaves it.
  if (input.companyPriority) {
    const { error: marked } = await jobs
      .from('companies')
      .update({ priority: input.companyPriority })
      .eq('id', company.id)
      .eq('user_id', ctx.userId);
    if (marked) throw new Error(marked.message);
  }

  const role = await one<{ id: string }>(
    jobs
      .from('roles')
      .insert({
        user_id: ctx.userId,
        company_id: company.id,
        title,
        jd_url: url,
        ats_job_id: atsJobId ?? detected?.jobId ?? null,
        location,
        ...(input.kind ? { kind: input.kind } : {}),
      })
      .select('id'),
  );
  if (!role) throw new Error('The role was not saved.');
  const { error } = await jobs.from('applications').insert({ user_id: ctx.userId, role_id: role.id, created_by: 'manual' });
  if (error) {
    await jobs.from('roles').delete().eq('id', role.id).eq('user_id', ctx.userId);
    throw new Error(error.message);
  }

  const ref = toRef(TABLE.role, role.id);
  const roleTitle = `${title} at ${companyName}`;
  return made(
    'add_job_lead',
    { roleId: role.id, roleTitle: title, companyName, url },
    {
      subjectRef: ref,
      op: 'insert',
      before: null,
      after: await readSubject(ctx.db, ref),
      summary: input.companyPriority
        ? `Dash saved ${roleTitle} to your leads and marked ${companyName} as ${input.companyPriority}.`
        : `Dash saved ${roleTitle} to your leads.`,
      row: { table: TABLE.role, ref: role.id, title: roleTitle, href: `/jobs/roles/${role.id}` },
    },
  );
}

// ---------------------------------------------------------------------------
// Dev
// ---------------------------------------------------------------------------

/** Longest idea Dash files, the ideas page's own limit. */
const IDEA_MAX = 4000;

/**
 * File an idea on the ideas page, as the person's own: they asked for it, so
 * it reads as one they typed into the box there, the way a goal they ask for
 * goes in approved. Undo deletes it while nothing hangs from it.
 */
async function addIdea(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const body = text(args, 'text');
  if (body.length < 3) throw new Refused('text is missing: write the idea in a sentence.');
  if (body.length > IDEA_MAX) throw new Refused(`Keep the idea under ${IDEA_MAX} characters.`);
  const workspace = text(args, 'module') || null;
  if (workspace && !(MODULE_IDS as readonly string[]).includes(workspace)) {
    throw new Refused(`"${workspace}" is not a workspace. Use one of ${MODULE_IDS.join(', ')}, or leave it out for the app as a whole.`);
  }

  // The ideas page's own write.
  const filed = await insertIdea(await ctx.db('public'), { userId: ctx.userId, body, module: workspace });
  if (filed.error) throw new Error(filed.error);
  if (!filed.id) throw new Error('The idea was not saved.');
  const idea = { id: filed.id };
  const ref = toRef(TABLE.idea, idea.id);
  const line = body.split('\n')[0].trim();
  const short = line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
  return made(
    'add_idea',
    { body, module: workspace },
    {
      subjectRef: ref,
      op: 'insert',
      before: null,
      after: await readSubject(ctx.db, ref),
      summary: `Dash filed your idea "${short}" on the ideas page.`,
      row: { table: TABLE.idea, ref: idea.id, title: short, href: '/dev/ideas' },
    },
  );
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/** Longest quick note Dash saves, the capture box's own limit. */
const QUICK_NOTE_MAX = 4000;

/**
 * Save a quick thought as a quick note: a new note in the vault's Inbox,
 * committed to the notes repository as the Vault page's quick note box and
 * the capture box write it (fileVaultNote), and left there to be sorted in
 * Quick note triage. Undo takes the file back out of the repository while it
 * is still as written (undoVaultCapture), which is why the blob SHA it was
 * written at is kept.
 */
async function addQuickNote(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  requireWorkspace(ctx, 'vault');
  const body = text(args, 'text');
  if (body.length < 2) throw new Refused('text is missing: write the thought as they said it.');
  if (body.length > QUICK_NOTE_MAX) throw new Refused(`Keep the note under ${QUICK_NOTE_MAX} characters.`);
  if (!ctx.quickNotePorts) throw new Refused('Quick notes cannot be saved from here.');

  // The Vault page's own write (addQuickNote through fileVaultNote): the note
  // in the Inbox, named from its text.
  const filed = await createCapturedNote(await ctx.quickNotePorts(), body);
  if (!filed.ok) throw new Refused(filed.error);
  const ref = toRef(TABLE.note, filed.noteId);
  const line = body.split('\n')[0].trim();
  const short = line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
  return made(
    'add_quick_note',
    { noteId: filed.noteId, title: filed.title, path: filed.path, body },
    {
      subjectRef: ref,
      op: 'insert',
      before: null,
      after: await readSubject(ctx.db, ref),
      summary: `Dash saved the quick note "${short}" to your vault's Inbox.`,
      undo: { vault_blob_sha: filed.blobSha },
      row: { table: TABLE.note, ref: filed.noteId, title: filed.title, href: noteHref(filed.path) },
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

/** How a todo Dash adds is tagged (plan #2340.4); the rule itself is lib/todo/tasks/dash-tags.ts. */
const ADD_TAGS_HELP =
  'It arrives tagged: now when it is due today or before, eventually when it has no date or one more than two weeks off; that tag is added for you. Send tags only for more: now for one they said they need today without a day, and any tag they already use (the todos lookup lists them in tags_in_use) that clearly fits. Do not make up new tags.';

const TAGS_PROP = {
  type: 'array',
  items: { type: 'string' },
  description: 'Tags beyond the one its date gives, lowercase, from the ones they already use.',
} as const;

function tool(
  name: DashChangeKind,
  runs: DashWriteRuns,
  description: string,
  input_schema: Anthropic.Tool['input_schema'],
  run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>,
): DashWriteTool<DashWriteResult> {
  return {
    name,
    kind: 'write',
    runs,
    definition: { name, description: `${description} ${DONE_NOTE}`, input_schema },
    apply: guarded(name, run),
  };
}

/** The write tools, in the order the model is sent them. */
export const WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  tool(
    'add_todo',
    sameAs(
      ['app/todo/actions.ts#addTask', 'lib/todo/tasks/write.ts#insertTask'],
      ['app/todo/link-actions.ts#addLinkedTask', 'lib/todo/tasks/write.ts#insertTask'],
    ),
    `Add a todo to the person's list, when they ask you to. ${ADD_TAGS_HELP}`,
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The todo as they would write it, in a short line.' },
        due_on: { ...DAY_PROP, description: 'The day it is due, YYYY-MM-DD, only when they named one ("on Friday", "today").' },
        tags: TAGS_PROP,
      },
      required: ['title'],
      additionalProperties: false,
    },
    (ctx, args) => addTodo(ctx, args),
  ),
  tool(
    'change_todo',
    sameAs(
      ['app/todo/actions.ts#editTask', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#renameTaskAction', 'lib/todo/tasks/write.ts#updateTaskFields'],
      ['app/todo/actions.ts#rescheduleTaskAction', 'lib/todo/tasks/write.ts#updateTaskFields'],
    ),
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
    sameAs(['app/todo/actions.ts#completeTask', 'lib/todo/tasks/write.ts#completeTaskWithItems']),
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
    noButton(
      'No Goals page adds a goal by hand: goals come in through capture, and the Level 3 goal on Subjects is an offer the person accepts.',
    ),
    'Add a new goal under one of their areas, when they ask for one. Name the area by its name as they have it. When none of their areas fits the goal, make one: pass new_area true with a short name for it ("Music"), rather than asking. Only when they asked for a goal: a step under an existing goal is add_goal_step.',
    {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'The name of the area the goal goes under.' },
        new_area: { type: 'boolean', description: 'True to make a new area by that name, when none of theirs fits.' },
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
    sameAs(['app/goals/[goalId]/actions.ts#addStep', 'lib/goals/steps-store.ts#insertStep']),
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
    sameAs(
      ['app/goals/[goalId]/actions.ts#setStepStatusAction', 'lib/goals/steps-store.ts#setStepStatus'],
      ['app/goals/[goalId]/block-actions.ts#setGoalStepStatus', 'lib/goals/steps-store.ts#setStepStatus'],
    ),
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
    'set_goal_done_when',
    sameAs(['app/goals/actions.ts#editGoal', 'lib/goals/store.ts#updateGoal']),
    "Write, change or clear the done-when of one of their goals, when they ask for it: the line that says when the goal is finished (\"the song is live on Spotify\"). Name the goal by the goals.items ref search (kinds [\"goal\"]) or goal_status returned for it; look it up first. Write it in their words. An empty done_when clears it.",
    {
      type: 'object',
      properties: {
        goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
        done_when: { type: 'string', description: 'The done-when, as they said it; empty to clear it.' },
      },
      required: ['goal_ref', 'done_when'],
      additionalProperties: false,
    },
    setGoalDoneWhen,
  ),
  tool(
    'mark_returned',
    sameAs(
      ['app/shopping/inventory/actions.ts#markInventoryReturned', 'lib/returns/mark.ts#markReturned'],
      ['app/shopping/returns/actions.ts#markItemReturned', 'lib/returns/mark.ts#markReturned'],
    ),
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
    // The role page's notes are its thread (lib/thread/store.ts). The company page's notes,
    // addNote, are change_company's `note` (plan #2473.8).
    sameAs(['app/jobs/(app)/roles/[id]/comment-actions.ts#addRoleComment', 'lib/thread/store.ts#addThreadTurn']),
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
  tool(
    'add_job_lead',
    noButton('No Jobs page adds a role by hand: leads come in from capture, from email and from the find page.'),
    'Save a job to their leads in Jobs, when they ask you to ("add this job to my leads", a pasted posting link). Pass the posting link when there is one; the title and the company are read from the posting when it names them, so a bare link is enough and you do not ask for the company first. Pass the title and company when they named them or you know them. If the posting names no company the call says so, and then you ask. When the role is on the page they are on, use its title, company and link. When there is no link and no role you can name, ask them for the link rather than calling this. To mark the company a target as well, pass company_priority; for a job already saved, mark its company with change_company. An application that is not a job, such as an accelerator they apply to as a founder, is saved the same way with kind: the title is what they would be (such as "Founder"), the company is the programme (such as Antler).',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The job posting link, when there is one.' },
        title: { type: 'string', description: 'The role title, when they gave it or you know it.' },
        company: { type: 'string', description: 'The company the role is at.' },
        kind: {
          type: 'string',
          enum: [...ROLE_KINDS],
          description: 'What kind of opening it is. Leave it out for a job; accelerator, fellowship, grant or other for the rest.',
        },
        company_priority: {
          type: 'string',
          enum: [...COMPANY_PRIORITIES],
          description:
            'When they say so, how much they want to work at the company: target, interested, backup or passed. It is set on the company, found or added, and stays if the lead is undone. Leave it out to keep the company as it is.',
        },
      },
      additionalProperties: false,
    },
    addJobLead,
  ),
  tool(
    'add_idea',
    sameAs(
      ['app/dev/ideas/actions.ts#addIdea', 'lib/ideas/insert.ts#insertIdea'],
      ['app/dev/ideas/actions.ts#submitIdea', 'lib/ideas/insert.ts#insertIdea'],
    ),
    'File an idea on the ideas page in Dev, when they ask you to note an idea for the app ("add an idea to Dev", "file that as an idea"). Write it as they said it, readable among other ideas.',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: "The idea in the person's own terms, a sentence or two." },
        module: {
          type: 'string',
          description: 'The workspace it is about, by id (jobs, goals, learn, dev and so on); leave it out for the app as a whole.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    addIdea,
  ),
  tool(
    'change_items',
    sameAs(
      ['app/shopping/inventory/actions.ts#disposeInventoryItem', 'lib/inventory/unit-changes.ts#disposeUnits'],
      ['app/shopping/inventory/actions.ts#quickDisposeInventoryItem', 'lib/inventory/unit-changes.ts#disposeUnits'],
      ['app/shopping/inventory/actions.ts#setItemsForSale', 'lib/inventory/unit-changes.ts#setUnitsFlag'],
      ['app/shopping/inventory/actions.ts#toggleItemForSaleForm', 'lib/inventory/unit-changes.ts#setUnitsFlag'],
      ['app/shopping/inventory/group-actions.ts#groupItemsTogether', 'lib/inventory/group-units.ts#groupUnits'],
      ['app/shopping/inventory/group-actions.ts#separateCopy', 'lib/inventory/group-units.ts#separateUnit'],
      ['app/shopping/inventory/group-actions.ts#ungroupItems', 'lib/inventory/group-units.ts#ungroupUnits'],
      ['app/shopping/returns/actions.ts#setReturnPlanned', 'lib/inventory/unit-changes.ts#setUnitsFlag'],
      ['app/shopping/returns/actions.ts#toggleReturnPlannedForm', 'lib/inventory/unit-changes.ts#setUnitsFlag'],
      ['app/shopping/returns/actions.ts#setItemsReturnPlanned', 'lib/inventory/unit-changes.ts#setUnitsFlag'],
    ),
    `Change many of the items they own in Shopping at once, when they ask ("mark everything from the March Amazon order for sale", "put these on the to-return list"). When a query_rows lookup matched the items (or the orders) and named the match as a set, pass set and nothing else to name them: it holds every row the lookup matched, listed or not, so never copy refs out of it. Otherwise name the items by the public.inventory_items refs lookups returned, or name whole orders by the public.orders refs search or spend_by_merchant returned, and every item from those orders is changed. At most ${BULK_MAX} items. change is one of: for_sale (mark for sale), not_for_sale (take off the sell page), to_return (mark to return), not_returning (take off the to-return list), group (group copies of one thing as one item, two or more), dispose (they sold, gave away, donated, threw out, recycled or used them up: give disposal_method, and proceeds for one item sold), ungroup (every copy in the groups those items are in stacks by its own details again), separate (hold each copy out of its stack as an item of its own). Only items they still own are changed, except that ungroup takes any. Deleting items is not something you can do: say it is done from the inventory list. One Undo puts the whole change back. Say how many items it changed.`,
    {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...ITEM_CHANGES], description: 'Which change to make to every item.' },
        disposal_method: {
          type: 'string',
          enum: [...DISPOSAL_METHODS],
          description: 'For dispose: how they got rid of them. gifted is given away; trashed is thrown out; consumed is used up.',
        },
        proceeds: { type: 'number', description: 'For dispose of one item: what they got for it, in dollars.' },
        set: {
          type: 'string',
          description:
            'The set a query_rows lookup of public.inventory_items or public.orders named, such as "set 1": every item it matched, or every item from the orders it matched. Prefer it to listing refs.',
        },
        item_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: BULK_MAX,
          description: 'The public.inventory_items refs lookups returned for the items, when no set holds them.',
        },
        order_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'The public.orders refs lookups returned, to change every item from those orders.',
        },
      },
      required: ['change'],
      additionalProperties: false,
    },
    changeItems,
  ),
  tool(
    'move_roles',
    sameAs(
      ['app/jobs/(app)/pipeline/actions.ts#moveApplication', 'lib/jobs/applications/stage.ts#moveApplicationsTo'],
    ),
    `Move many of their job roles to one stage at once, or archive them, when they ask ("archive every role I applied to before August with no reply", "move these three to in process"). When a query_rows lookup of job_search.roles or job_search.applications matched exactly the roles to move, pass the set it named as set instead of listing them. Otherwise name the roles by the job_search.applications refs job_applications returned, or the job_search.roles refs search returned; find them with a lookup first, and for "no reply" use job_applications with no_reply. A lookup lists 50 at most: when it says more matched, narrow by date and look again so every one is named. At most ${BULK_MAX} roles. stage is one of: lead, drafting, submitted, in_process, final_round, offer, rejected, withdrawn, role_closed, or archive (takes them off the board as withdrawn; a role already closed is left as it is). Ghosted cannot be set: it is worked out from silence. Deleting roles is not something you can do: say it is done on the pipeline. Each move goes into the role's history as the board's would. One Undo puts the whole move back. Say how many roles it moved.`,
    {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: [...ROLE_STAGES], description: 'The stage to move every role to, or archive.' },
        set: {
          type: 'string',
          description:
            'The set a query_rows lookup of job_search.roles or job_search.applications named, such as "set 1": every row it matched is moved.',
        },
        application_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: BULK_MAX,
          description: 'The job_search.applications refs job_applications returned.',
        },
        role_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: BULK_MAX,
          description: 'The job_search.roles refs search returned; each moves by its latest application.',
        },
      },
      required: ['stage'],
      additionalProperties: false,
    },
    moveRoles,
  ),
  tool(
    'add_quick_note',
    sameAs(['app/vault/actions.ts#addQuickNote', 'lib/vault/notes/create.ts#createCapturedNote']),
    'Save a quick thought as a quick note in their vault, when they ask you to note, jot down or save a thought ("add this to my quick thoughts", "save this thought"). It goes in the vault\'s Inbox, where Quick note triage sorts it later. Write it word for word as they gave it. Not for a todo, an idea for the app, a goal or a note on a role, which have tools of their own.',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The thought, in their words, word for word when they dictated it.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    addQuickNote,
  ),
  // Learn's, which the connector offers too (plan #1894.8).
  ...LEARN_WRITE_TOOLS,
  // Todo's, which the connector offers too (plan #1894.9.1).
  ...TODO_WRITE_TOOLS,
  // You's places, which the connector offers too (plan #1991.5).
  ...YOU_WRITE_TOOLS,
  // News's, and stopping a watch, which the connector offers too (plan #1894.9.4).
  ...NEWS_WRITE_TOOLS,
  // Goals' areas and goals, which the connector offers too (plan #1894.7.1).
  ...GOALS_WRITE_TOOLS,
  // Shopping's one-item and list changes, which the connector offers too (plan #1894.5.1).
  ...SHOPPING_WRITE_TOOLS,
  // The Vault's notes, themes and Maya questions, and a course (plan #1894.9.3).
  ...VAULT_WRITE_TOOLS,
  // Jobs' role and application edits, which the connector offers too (plan #1894.6.1).
  ...JOBS_WRITE_TOOLS,
  // A round on a role (plan #2044.1).
  ...INTERVIEW_WRITE_TOOLS,
  // A post draft's text (plan #2202.1).
  ...POST_WRITE_TOOLS,
  ...MODEL_WRITE_TOOLS,
];

/** The names of the write tools, which are also the kinds their records carry. */
export const WRITE_TOOL_NAMES = WRITE_TOOLS.map((t) => t.name);

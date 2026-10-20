import type { GoalsActor, GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertStep, setStepArchived } from '@/lib/goals/steps-store';
import type { ModuleId } from '@/lib/modules';
import { markReturned, unmarkReturned } from '@/lib/returns/mark';
import type { TaskInput } from '@/lib/todo/tasks/input';
import { MANY_ROW_KINDS, readSubject, undoDashAction, type DashAction } from '@/lib/core/dash-actions';
import { undoItemChange } from '@/lib/dash/bulk-items';
import { undoAddedTodos } from '@/lib/dash/todo-writes';
import { undoShoppingChange } from '@/lib/dash/shopping-writes';
import { JOBS_ROWS_KINDS } from './jobs-changes';
import { isShoppingChangeKind } from './shopping-changes';
import { undoRoleMove } from '@/lib/dash/bulk-roles';
import { undoDiscoveredCompany } from '@/lib/dash/career-writes';
import { undoAddedCompany, undoApplicationQuestions, undoContactRows, undoJobsRows, undoRoleEmail, undoRoleFromEmail, undoRoleMerge } from '@/lib/dash/jobs-writes';
import { handStepToClaude } from '@/lib/plan/handover';
import { roundConversationMoved } from '@/lib/dash/interview-writes';
import { toRef } from '@/lib/core/refs';
import { DELETABLE, deleteRows, isDeletableTable, undoDeletedRows } from './delete-rows';
import {
  DASH_ACTIONS,
  type NewDashChange,
  DASH_CHANGE_SELECT,
  PROPOSAL_KINDS,
  toDashChange,
  type DashChange,
  type DashChangeKind,
  type DashChangeStatus,
} from '@/lib/talk/changes';
import type { AskDb, SchemaClient } from './db';
import type { DashPaidTool } from '@/lib/dash/registry';
import { PAID_NO_UNDO, PAID_RUN_STALE_MS, paidState } from '@/lib/dash/paid-input';
import { isWrittenCard, type WrittenCardKind } from './todo-changes';
import { isVaultFileKind } from './vault-changes';

/**
 * Confirming, declining and undoing a change Dash proposed in an Ask Dash
 * answer (plan #1189, feature #1186).
 *
 * Confirm writes the change through the code the page itself uses: a todo
 * through createTask, a step through insertStep on a goals client that records
 * it in goals.history as Dash's, a return through markReturned (the returns
 * page's own). It then marks the change done with the row it wrote and that
 * row's values before and after (plan #1458), in
 * one update that only a still-proposed change takes, so a second Confirm
 * (another window, a double press) finds nothing to update and the row it
 * wrote is taken back again. A change is written once.
 *
 * Undo takes the row back only while nothing has happened to it since, the
 * rule a run's page uses for its Undo (plan #1013), so it never throws away
 * later work:
 *
 *   add_todo       deleted while it is still open, has the title, date and
 *                  pin it was written with, and has no items or links under it.
 *   add_goal_step  archived while it is live and still open, has no steps
 *                  under it, and goals.history shows no change to it since it
 *                  went in beyond a reorder. The archive is written as yours
 *                  and names the insert it undoes (history.undoes).
 *   mark_returned  the returns row deleted, as the returns page's Undo does,
 *                  while the item is still returned and the return is still
 *                  refunded at the amount written.
 *   start_watch    the watch deleted, with its readings, while it is still
 *                  running and has sent no push. One that has is stopped
 *                  from its home row instead (plan #1296).
 *
 * Since plan #1440 Dash makes these four straight away when asked (lib/dash/
 * writes.ts runs writeChange below and keeps the change as done), and adds
 * five more kinds of its own: a goal, a renamed or moved todo, a ticked-off
 * todo, a closed goal step and a note on a role. Those five are undone by
 * the one rule in lib/core/dash-actions.ts, from the values the record
 * kept; a ticked-off todo also reopens the items on its list that went with
 * it.
 *
 * Every refusal is a sentence the person reads in place of the button, and
 * names Dash, not Claude.
 *
 * No `server-only` and no clients made here: lib/talk/ask-request.ts builds
 * the dependencies from the request, and the tests hand in stubs.
 */

export type ChangeDeps = {
  userId: string;
  /** The person's timezone, for a todo's due time. */
  timezone: string;
  /** YYYY-MM-DD in that timezone: the day a return is refunded. */
  today: string;
  enabledModules: readonly ModuleId[];
  /** The person's core client, for core.dash_actions. */
  core: SchemaClient;
  /** The person's client per schema: reads, the undo writes, and the return. */
  db: AskDb;
  /** A goals client recording its writes as `actor`, undoing the history row `undoes`. */
  goals: (history: { actor?: GoalsActor; undoes?: number }) => Promise<GoalsSupabaseClient>;
  /** createTask from lib/todo/tasks/write.ts. */
  createTask: (userId: string, input: TaskInput, timezone: string) => Promise<{ id: string | null; error: string | null }>;
  /** Now, as an ISO timestamp. */
  now?: () => string;
  /**
   * Takes a quick note Dash wrote back out of the vault and marks its record
   * undone (undoVaultCapture in lib/capture/vault.ts, bound to the person).
   * Absent where there is no vault to reach, and then the Undo is refused.
   */
  undoVaultNote?: (
    action: Pick<DashAction, 'id' | 'status' | 'subjectRef' | 'undo'>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * The paid tool of that name in Dash's registry (plan #2228.1), which an
   * approved paid press runs. Absent: every paid press is refused.
   */
  paidTool?: (name: string) => DashPaidTool | undefined;
};

/** What the card or the list shows after a press: the change as it now is, or why not. */
export type ChangeOutcome =
  | { ok: true; change: DashChange }
  | { ok: false; error: string; change: DashChange | null };

/** Where each kind's row is shown; in change-view.ts so the client cards can read it. */
export { changeHref } from './change-view';

/** The pages a change lands on, to revalidate after a confirm or an undo. */
export function changePaths(change: DashChange): string[] {
  if (isWrittenCard(change)) return change.input.paths;
  switch (change.kind) {
    case 'add_todo':
      return ['/todo', '/todo/all', '/home'];
    case 'add_goal_step':
      return ['/goals', `/goals/${change.input.parentId}`];
    case 'mark_returned':
      return [
        '/shopping/returns',
        '/shopping/inventory',
        `/shopping/inventory/${change.input.id}`,
        '/shopping/orders',
        '/shopping/dashboard',
      ];
    case 'start_watch':
      return ['/home'];
    case 'add_goal':
      return ['/goals', ...(change.writtenRef ? [`/goals/${change.writtenRef}`] : [])];
    case 'change_todo':
    case 'close_todo':
      return ['/todo', '/todo/all', '/home'];
    case 'close_goal_step':
      return ['/goals', `/goals/${change.input.goalId}`];
    case 'set_goal_done_when':
      return ['/goals', `/goals/${change.input.id}`];
    case 'add_role_note':
      return [`/jobs/roles/${change.input.roleId}`];
    case 'add_idea':
      return ['/dev/ideas'];
    case 'add_job_lead':
      return ['/jobs/roles', '/jobs/pipeline', `/jobs/roles/${change.input.roleId}`];
    case 'change_items': {
      const rows = Array.isArray(change.undo?.rows) ? (change.undo.rows as { id?: unknown }[]) : [];
      return [
        '/shopping/inventory',
        '/shopping/sell',
        '/shopping/returns',
        '/shopping/dashboard',
        ...rows.flatMap((row) => (typeof row.id === 'string' ? [`/shopping/inventory/${row.id}`] : [])),
      ];
    }
    case 'move_roles': {
      const rows = Array.isArray(change.undo?.rows) ? (change.undo.rows as { role_id?: unknown }[]) : [];
      return [
        '/jobs',
        '/jobs/pipeline',
        '/jobs/roles',
        ...rows.flatMap((row) => (typeof row.role_id === 'string' ? [`/jobs/roles/${row.role_id}`] : [])),
      ];
    }
    case 'add_quick_note':
      return ['/vault', '/vault/triage'];
    case 'start_build':
      return ['/dev/plan', `/dev/plan/${change.input.number}`];
    case 'paid_action':
      return change.input.paths;
    case 'delete_rows':
      return [change.input.href, '/home', '/jobs/pipeline'];
  }
}

/** The workspace each kind writes into; a watch is the home page's and needs none. */
/**
 * The kinds with a writer here: Learn's and Todo's newer ones are written by
 * their tools alone (lib/dash/learn-writes.ts, lib/dash/todo-writes.ts).
 */
type WrittenKind = Exclude<DashChangeKind, WrittenCardKind | 'paid_action' | 'delete_rows'>;

const WORKSPACE: Record<WrittenKind, { module: ModuleId; label: string } | null> = {
  add_todo: { module: 'todo', label: 'Todo' },
  add_goal_step: { module: 'goals', label: 'Goals' },
  mark_returned: { module: 'shopping', label: 'Shopping' },
  start_watch: null,
  add_goal: { module: 'goals', label: 'Goals' },
  change_todo: { module: 'todo', label: 'Todo' },
  close_todo: { module: 'todo', label: 'Todo' },
  close_goal_step: { module: 'goals', label: 'Goals' },
  add_role_note: { module: 'jobs', label: 'Jobs' },
  add_idea: null,
  add_job_lead: { module: 'jobs', label: 'Jobs' },
  change_items: { module: 'shopping', label: 'Shopping' },
  move_roles: { module: 'jobs', label: 'Jobs' },
  set_goal_done_when: { module: 'goals', label: 'Goals' },
  add_quick_note: { module: 'vault', label: 'Vault' },
  start_build: { module: 'dev', label: 'Dev' },
};

const WRITTEN_TABLE: Record<WrittenKind, string> = {
  add_todo: 'todo.tasks',
  add_goal_step: 'goals.items',
  mark_returned: 'public.inventory_items',
  start_watch: 'core.watches',
  add_goal: 'goals.items',
  change_todo: 'todo.tasks',
  close_todo: 'todo.tasks',
  close_goal_step: 'goals.items',
  add_role_note: 'core.conversation_turns',
  add_idea: 'public.ideas',
  add_job_lead: 'job_search.roles',
  change_items: 'public.inventory_items',
  move_roles: 'job_search.applications',
  set_goal_done_when: 'goals.items',
  add_quick_note: 'obsidian.notes',
  // The run the confirm starts (plan #2106.2).
  start_build: 'public.plan_runs',
};

/** What each kind does to that row: a return changes the item, the rest add one. */
const WRITTEN_OP: Record<WrittenKind, 'insert' | 'update'> = {
  add_todo: 'insert',
  add_goal_step: 'insert',
  mark_returned: 'update',
  start_watch: 'insert',
  add_goal: 'insert',
  change_todo: 'update',
  close_todo: 'update',
  close_goal_step: 'update',
  add_role_note: 'insert',
  add_idea: 'insert',
  add_job_lead: 'insert',
  change_items: 'update',
  move_roles: 'update',
  set_goal_done_when: 'update',
  add_quick_note: 'insert',
  start_build: 'insert',
};

/** A refusal the person reads: the sentence is theirs, the class only marks it as one. */
class Refused extends Error {}

const GONE = 'That change is not there any more.';

function now(deps: ChangeDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

/** The surfaces whose records Ask's undo takes back. */
type ChangeSurface = 'ask' | 'thread' | 'routine';

async function loadOne(deps: ChangeDeps, id: string, surface: ChangeSurface = 'ask'): Promise<DashChange | null> {
  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .select(DASH_CHANGE_SELECT)
    .eq('id', id)
    .eq('user_id', deps.userId)
    .eq('surface', surface)
    .maybeSingle();
  if (error) throw new Error(`Reading the change failed: ${error.message}`);
  return data ? toDashChange(data) : null;
}

/** Why a change in this status cannot be confirmed or declined. */
function notProposed(status: DashChangeStatus): string {
  switch (status) {
    case 'done':
      return 'You have already confirmed this change.';
    case 'declined':
      return 'You declined this change, so it cannot be confirmed now. Ask Dash again if you want it.';
    case 'undone':
      return 'This change was confirmed and then undone. Ask Dash again if you want it back.';
    default:
      return 'This change is waiting for your answer.';
  }
}

/** Why a change in this status cannot be undone. */
function notConfirmed(status: DashChangeStatus): string {
  switch (status) {
    case 'proposed':
      return 'Nothing has been written yet, so there is nothing to undo.';
    case 'declined':
      return 'You declined this change, so nothing was written.';
    case 'undone':
      return 'This change has already been undone.';
    default:
      return 'This change cannot be undone.';
  }
}

// ---------------------------------------------------------------------------
// Writers: one per kind. Each re-reads what the proposal checked, since that
// check may be hours old, and returns the row it wrote.
// ---------------------------------------------------------------------------

/** The four kinds that were proposals first, which write and undo by their own code here. */
type ProposalChange = Extract<DashChange, { kind: 'add_todo' | 'add_goal_step' | 'mark_returned' | 'start_watch' }>;

function isProposalKind(change: DashChange): change is ProposalChange {
  // A started build is a proposal too, but it has no writer or undo here.
  return change.kind !== 'start_build' && PROPOSAL_KINDS.includes(change.kind);
}

/** Why a started build has no Undo. */
export const BUILD_NO_UNDO = 'A build that has started cannot be undone.';

type Written = { ref: string; undo: Record<string, unknown> | null };

async function writeTodo(deps: ChangeDeps, change: Extract<DashChange, { kind: 'add_todo' }>): Promise<Written> {
  const input = change.input;
  const { id, error } = await deps.createTask(
    deps.userId,
    { title: input.title, body: input.body, dueOn: input.dueOn, dueTime: input.dueTime, pinned: input.pinned, tags: input.tags ?? [] },
    deps.timezone,
  );
  if (error || !id) throw new Error(error ?? 'The todo was not written.');
  return { ref: id, undo: null };
}

async function writeGoalStep(
  deps: ChangeDeps,
  change: Extract<DashChange, { kind: 'add_goal_step' }>,
): Promise<Written> {
  const { parentId, title, kind } = change.input;
  const reader = await deps.db('goals');
  const { data: goal, error } = await reader
    .from('items')
    .select('id, level, status, approved_at')
    .eq('id', parentId)
    .eq('user_id', deps.userId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!goal || goal.level !== 'goal') throw new Refused('That goal has been archived or is not there any more.');
  if (goal.status === 'done' || goal.status === 'dropped') {
    throw new Refused(`That goal is ${goal.status as string} now, so a step cannot go under it.`);
  }
  if (goal.status === 'proposed' || !goal.approved_at) {
    throw new Refused('That goal is still a proposal. Approve it first, then Dash can add the step.');
  }
  const client = await deps.goals({ actor: 'claude' });
  const id = await insertStep(client, deps.userId, parentId, { title, kind });
  if (!id) throw new Refused('That goal has been archived or is not there any more.');
  return { ref: id, undo: null };
}

async function writeReturned(
  deps: ChangeDeps,
  change: Extract<DashChange, { kind: 'mark_returned' }>,
): Promise<Written> {
  const marked = await markReturned(await deps.db('public'), deps.userId, change.input.id, deps.today);
  if (!marked.ok) throw new Refused(marked.error);
  return {
    ref: change.input.id,
    undo: { return_id: marked.returnId, refund_amount_cents: marked.refundCents },
  };
}

async function writeWatch(deps: ChangeDeps, change: Extract<DashChange, { kind: 'start_watch' }>): Promise<Written> {
  const watch = change.input;
  if (Date.parse(watch.endsAt) <= Date.parse(now(deps))) {
    throw new Refused('That watch would already have ended. Ask Dash again with a later end.');
  }
  const core = deps.core;
  const { data: same, error: sameError } = await core
    .from('watches')
    .select('id')
    .eq('user_id', deps.userId)
    .eq('status', 'running')
    .eq('url', watch.url)
    .limit(1);
  if (sameError) throw new Error(sameError.message);
  if ((same ?? []).length > 0) throw new Refused('A watch on that page is already running. It is on the home page.');

  const condition: Record<string, unknown> = {};
  if (watch.below !== null) condition.below = watch.below;
  if (watch.currency) condition.currency = watch.currency;
  const { data, error } = await core
    .from('watches')
    .insert({
      user_id: deps.userId,
      title: watch.title,
      url: watch.url,
      condition,
      report_times: watch.reportTimes,
      ends_at: watch.endsAt,
      goal_item_id: watch.goalItemId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'The watch was not written.');
  return { ref: data.id as string, undo: null };
}

async function write(deps: ChangeDeps, change: ProposalChange): Promise<Written> {
  switch (change.kind) {
    case 'add_todo':
      return writeTodo(deps, change);
    case 'add_goal_step':
      return writeGoalStep(deps, change);
    case 'mark_returned':
      return writeReturned(deps, change);
    case 'start_watch':
      return writeWatch(deps, change);
  }
}

// ---------------------------------------------------------------------------
// Undoers: one per kind. Each says why it will not, as a Refused, when the
// row has moved on; `force` skips that check, for taking back a write whose
// confirm lost a race a moment ago.
// ---------------------------------------------------------------------------

async function undoTodo(deps: ChangeDeps, change: DashChange & { kind: 'add_todo' }, ref: string, force = false) {
  const todo = await deps.db('todo');
  if (!force) {
    const { data: task, error } = await todo
      .from('tasks')
      .select('id, title, body, status, due_on, due_at, pinned, snoozed_until')
      .eq('id', ref)
      .eq('user_id', deps.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!task) throw new Refused('That todo has since been deleted, so there is nothing to undo.');
    if (task.status === 'done') throw new Refused('You have ticked that todo off since, so Dash will not remove it.');
    if (task.status !== 'open') throw new Refused('You have dropped that todo since, so Dash will not remove it.');
    const input = change.input;
    const edited =
      task.title !== input.title ||
      (task.body ?? null) !== input.body ||
      (task.due_on ?? null) !== input.dueOn ||
      (task.due_at ?? null) !== null ||
      task.pinned !== input.pinned ||
      (task.snoozed_until ?? null) !== null;
    if (edited) throw new Refused('You have edited that todo since, so Dash will not remove it.');

    const [items, links] = await Promise.all([
      todo.from('tasks').select('id').eq('parent_id', ref).limit(1),
      todo.from('task_links').select('id').eq('task_id', ref).limit(1),
    ]);
    if (items.error) throw new Error(items.error.message);
    if (links.error) throw new Error(links.error.message);
    if ((items.data ?? []).length > 0) {
      throw new Refused('You have added items under that todo since, so Dash will not remove it.');
    }
    if ((links.data ?? []).length > 0) {
      throw new Refused('You have linked that todo to something since, so Dash will not remove it.');
    }
  }
  const { data, error } = await todo
    .from('tasks')
    .delete()
    .eq('id', ref)
    .eq('user_id', deps.userId)
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(error.message);
  if (!force && (data ?? []).length === 0) throw new Refused('That todo has changed since, so Dash will not remove it.');
}

/** Columns a later write may change without counting as work on the step. */
const NOT_WORK = new Set(['position', 'updated_at']);

async function undoGoalStep(deps: ChangeDeps, ref: string, force = false) {
  const reader = await deps.db('goals');
  const { data: insert, error: insertError } = await reader
    .from('history')
    .select('id')
    .eq('row_id', ref)
    .eq('table_name', 'items')
    .eq('action', 'insert')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (insertError) throw new Error(insertError.message);
  const historyId = (insert?.id as number | undefined) ?? undefined;

  if (!force) {
    const { data: step, error } = await reader
      .from('items')
      .select('id, status, archived_at')
      .eq('id', ref)
      .eq('user_id', deps.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!step) throw new Refused('That step has since been deleted, so there is nothing to undo.');
    if (step.archived_at) throw new Refused('That step has since been archived, so there is nothing to undo.');
    if (step.status !== 'open') throw new Refused('That step has been worked on since, so Dash will not archive it.');

    if (historyId !== undefined) {
      const { data: later, error: laterError } = await reader
        .from('history')
        .select('id, action, new_values')
        .eq('row_id', ref)
        .gt('id', historyId)
        .order('id', { ascending: true });
      if (laterError) throw new Error(laterError.message);
      const changed = ((later ?? []) as { action: string; new_values: Record<string, unknown> | null }[]).some(
        (h) => h.action !== 'update' || Object.keys(h.new_values ?? {}).some((k) => !NOT_WORK.has(k)),
      );
      if (changed) throw new Refused('That step has been edited or worked on since, so Dash will not archive it.');
    }

    const { data: children, error: childError } = await reader
      .from('items')
      .select('id')
      .eq('parent_id', ref)
      .is('archived_at', null)
      .limit(1);
    if (childError) throw new Error(childError.message);
    if ((children ?? []).length > 0) {
      throw new Refused('That step has steps under it now, so Dash will not archive it.');
    }
  }

  const writer = await deps.goals(historyId !== undefined ? { undoes: historyId } : {});
  const archived = await setStepArchived(writer, ref, true);
  if (!force && !archived) throw new Refused('That step has since been archived, so there is nothing to undo.');
}

async function undoReturned(deps: ChangeDeps, change: DashChange & { kind: 'mark_returned' }, force = false) {
  const returnId = typeof change.undo?.return_id === 'string' ? change.undo.return_id : null;
  if (!returnId) throw new Error('The change does not say which return it wrote.');
  const client = await deps.db('public');

  if (!force) {
    const [item, ret] = await Promise.all([
      client.from('inventory_items').select('id, status').eq('id', change.input.id).eq('user_id', deps.userId).maybeSingle(),
      client.from('returns').select('id, status, refund_amount_cents').eq('id', returnId).eq('user_id', deps.userId).maybeSingle(),
    ]);
    if (item.error) throw new Error(item.error.message);
    if (ret.error) throw new Error(ret.error.message);
    if (!item.data) throw new Refused('That item is not there any more, so there is nothing to undo.');
    if (!ret.data) throw new Refused('That return has since been removed, so there is nothing to undo.');
    if (item.data.status !== 'returned') {
      throw new Refused('That item is no longer marked returned, so there is nothing to undo.');
    }
    const written = change.undo?.refund_amount_cents ?? null;
    if (ret.data.status !== 'refunded' || (ret.data.refund_amount_cents ?? null) !== written) {
      throw new Refused('You have changed that return since, so Dash will not remove it.');
    }
  }

  const undone = await unmarkReturned(client, deps.userId, change.input.id, returnId);
  if (!undone.ok && !force) throw new Refused(undone.error);
}

async function undoWatch(deps: ChangeDeps, ref: string, force = false) {
  const core = deps.core;
  if (!force) {
    const { data: watch, error } = await core
      .from('watches')
      .select('id, status, fired_at, reported_at')
      .eq('id', ref)
      .eq('user_id', deps.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!watch) throw new Refused('That watch has since been removed, so there is nothing to undo.');
    if (watch.status !== 'running') {
      throw new Refused(`That watch has ${watch.status === 'stopped' ? 'been stopped' : 'ended'} since, so there is nothing to undo.`);
    }
    if (watch.fired_at || watch.reported_at) {
      throw new Refused('That watch has already sent you a push, so Dash will not remove it. Stop it from the home page instead.');
    }
  }
  let query = core.from('watches').delete().eq('id', ref).eq('user_id', deps.userId);
  if (!force) query = query.eq('status', 'running').is('fired_at', null).is('reported_at', null);
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  if (!force && (data ?? []).length === 0) throw new Refused('That watch has changed since, so Dash will not remove it.');
}

async function takeBack(deps: ChangeDeps, change: ProposalChange, ref: string, force = false): Promise<void> {
  switch (change.kind) {
    case 'add_todo':
      return undoTodo(deps, change, ref, force);
    case 'add_goal_step':
      return undoGoalStep(deps, ref, force);
    case 'mark_returned':
      return undoReturned(deps, change, force);
    case 'start_watch':
      return undoWatch(deps, ref, force);
  }
}

/** Take back a write whose confirm did not stick. Best effort: the error that stopped the confirm is the one that matters. */
async function rollBack(deps: ChangeDeps, change: ProposalChange, written: Written): Promise<void> {
  try {
    await takeBack(deps, { ...change, undo: written.undo } as ProposalChange, written.ref, true);
  } catch (error) {
    console.error(`ask change ${change.id}: taking back ${written.ref} failed`, error);
  }
}

/** The row an update kind changes, named before the write. */
function updatedId(change: DashChange): string {
  if (change.kind === 'mark_returned') return change.input.id;
  throw new Error(`${change.kind} adds a row and changes none.`);
}

/**
 * The row's values for the record (plan #1458). Best effort: a failed read
 * leaves the values empty rather than failing a write that has happened, and
 * the per-kind undo above does not need them.
 */
async function valuesOf(deps: ChangeDeps, ref: string): Promise<Record<string, unknown> | null> {
  try {
    return await readSubject(deps.db, ref);
  } catch (error) {
    console.error(`ask change: reading ${ref} for the record failed`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The three presses
// ---------------------------------------------------------------------------

function refusedOrThrow(error: unknown, change: DashChange | null): ChangeOutcome {
  if (error instanceof Refused) return { ok: false, error: error.message, change };
  throw error;
}

/**
 * Start the session a build card proposed (plan #2106.2).
 *
 * The step is checked again by handStepToClaude, so a step that was sent, closed
 * or blocked since the card was made is refused here with the plan page's own
 * sentence and nothing starts. The quiet run is written off only when the card
 * said the run was quiet. The change is marked done against the run the send
 * started; there is no undo, because a started session cannot be recalled.
 */
async function confirmBuild(deps: ChangeDeps, change: Extract<DashChange, { kind: 'start_build' }>): Promise<ChangeOutcome> {
  const client = await deps.db('public');
  const sent = await handStepToClaude({
    supabase: client as never,
    userId: deps.userId,
    id: change.input.stepId,
    confirmQuiet: change.input.quiet ? true : undefined,
  });
  if (!sent.ok) return { ok: false, error: sent.error, change };

  // startRoutineRun does not return the run it recorded, so the newest run on
  // the step is the one this press started.
  const { data: run } = await client
    .from('plan_runs')
    .select('id')
    .eq('user_id', deps.userId)
    .eq('plan_item_id', change.input.stepId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const runId = (run as { id?: string } | null)?.id;
  const subjectRef = runId ? toRef('public.plan_runs', runId) : null;

  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({
      status: 'done',
      done_at: now(deps),
      ...(subjectRef ? { subject_ref: subjectRef } : {}),
      op: 'insert',
      undo: null,
    })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    .select(DASH_CHANGE_SELECT);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (error || rows.length === 0) {
    // The session is already running and cannot be recalled; say so rather than
    // leave the card offering to start it again.
    if (error) throw new Error(`The build started but marking the card done failed: ${error.message}`);
    const current = await loadOne(deps, change.id);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/**
 * Delete the rows a delete card named (plan #2232.1), after the person
 * confirmed. deleteRows reads them again as the person and refuses, deleting
 * nothing, when one has changed since the snapshot. The removed rows are kept
 * in `undo.rows` for Undo; if marking the card done then fails or loses a
 * race, they are put back, since the card would otherwise offer to delete
 * rows that are already gone.
 */
async function confirmDelete(deps: ChangeDeps, change: Extract<DashChange, { kind: 'delete_rows' }>): Promise<ChangeOutcome> {
  if (!isDeletableTable(change.input.table)) {
    return { ok: false, error: 'Dash may not delete from that table.', change };
  }
  const spec = DELETABLE[change.input.table];
  if (!deps.enabledModules.includes(spec.module)) {
    return { ok: false, error: `The ${spec.moduleLabel} workspace is switched off, so this cannot be removed.`, change };
  }
  const removed = await deleteRows({ userId: deps.userId, db: deps.db }, change.input);
  if (!removed.ok) return { ok: false, error: removed.error, change };
  const first = removed.deleted.rows[0];

  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({
      status: 'done',
      done_at: now(deps),
      subject_ref: first.ref,
      op: 'delete',
      before_values: first.values,
      after_values: null,
      undo: removed.deleted as unknown as Record<string, unknown>,
    })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    .select(DASH_CHANGE_SELECT);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (error || rows.length === 0) {
    const back = await undoDeletedRows({ userId: deps.userId, db: deps.db }, removed.deleted as unknown as Record<string, unknown>);
    if (!back.ok) console.error(`ask change ${change.id}: putting back the rows failed`, back.error);
    if (error) throw new Error(`Marking the change done failed: ${error.message}`);
    const current = await loadOne(deps, change.id);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/**
 * Run a paid press Dash queued (plan #2228.1): the tool's `run`, which calls
 * the function the button calls and records the spend there.
 *
 * The press is claimed before it runs, by marking `undo.running_at` on a row
 * that is still proposed and not already running, so a second approval
 * (another window, a double press) finds it taken and runs nothing. A run
 * that refuses or breaks leaves the item proposed with `undo.failed`, so the
 * card can say why and it can be approved again or dismissed. One left
 * running longer than PAID_RUN_STALE_MS can be claimed again. Once it has
 * run, the item is done with the row the press wrote, and has no Undo: the
 * money is spent.
 */
async function confirmPaid(
  deps: ChangeDeps,
  change: Extract<DashChange, { kind: 'paid_action' }>,
  surface: ChangeSurface,
): Promise<ChangeOutcome> {
  const tool = deps.paidTool?.(change.input.tool);
  if (!tool) return { ok: false, error: 'Dash can no longer run this. Press the button on its page instead.', change };
  if (tool.workspace && !deps.enabledModules.includes(tool.workspace)) {
    return { ok: false, error: 'Its workspace is switched off, so this cannot be run.', change };
  }
  const startedAt = now(deps);
  const stale = new Date(Date.parse(startedAt) - PAID_RUN_STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await deps.core
    .from(DASH_ACTIONS)
    .update({ undo: { running_at: startedAt } })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    .or(`undo.is.null,undo->>failed.not.is.null,undo->>running_at.lt.${stale}`)
    .select('id');
  if (claimError) throw new Error(`Claiming the press failed: ${claimError.message}`);
  if ((claimed ?? []).length === 0) {
    const current = await loadOne(deps, change.id, surface);
    if (current?.status === 'proposed' && paidState(current.undo).state === 'running') {
      return { ok: false, error: 'Dash is already running this.', change: current };
    }
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }

  let ran: Awaited<ReturnType<DashPaidTool['run']>>;
  try {
    ran = await tool.run(
      {
        userId: deps.userId,
        timezone: deps.timezone,
        today: deps.today,
        enabledModules: deps.enabledModules,
        db: deps.db,
        now: new Date(Date.parse(startedAt)),
      },
      change.input.args,
    );
  } catch (error) {
    console.error(`paid press ${change.input.tool} failed`, error);
    ran = { ok: false, error: 'Dash could not run this. Try again.' };
  }

  if (!ran.ok) {
    const { data } = await deps.core
      .from(DASH_ACTIONS)
      .update({ undo: { failed: ran.error } })
      .eq('id', change.id)
      .eq('user_id', deps.userId)
      .eq('status', 'proposed')
      .select(DASH_CHANGE_SELECT);
    const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
    return { ok: false, error: ran.error, change: rows[0] ? toDashChange(rows[0]) : change };
  }

  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({
      status: 'done',
      done_at: now(deps),
      subject_ref: ran.subjectRef,
      op: ran.op,
      summary: ran.summary.replace(/\s+/g, ' ').trim().slice(0, 300),
      undo: { none: PAID_NO_UNDO },
    })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    .select(DASH_CHANGE_SELECT);
  // The press has run and spent; say so rather than offer to run it again.
  if (error) throw new Error(`The press ran but marking it done failed: ${error.message}`);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (rows.length === 0) {
    const current = await loadOne(deps, change.id, surface);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/**
 * A change to confirm or decline, with the surface it was kept on: Ask's, or
 * a paid press a thread queued (plan #2228.1), which is approved the same way.
 */
async function loadPressable(deps: ChangeDeps, id: string): Promise<{ change: DashChange; surface: ChangeSurface } | null> {
  const asked = await loadOne(deps, id);
  if (asked) return { change: asked, surface: 'ask' };
  const queued = await loadOne(deps, id, 'thread');
  return queued?.kind === 'paid_action' ? { change: queued, surface: 'thread' } : null;
}

/**
 * Write a proposed change and mark it done. Refused, with the change as
 * it stands, when it is not a proposal any more, its answer is still being
 * written, its workspace is off, or what it points at can no longer take it.
 */
export async function confirmChange(deps: ChangeDeps, id: string): Promise<ChangeOutcome> {
  const found = await loadPressable(deps, id);
  if (!found) return { ok: false, error: GONE, change: null };
  const { change, surface } = found;
  if (change.status !== 'proposed') return { ok: false, error: notProposed(change.status), change };
  if (!change.turnId) {
    return { ok: false, error: 'Dash is still writing this answer. Try again once it has finished.', change };
  }
  if (change.kind === 'paid_action') return confirmPaid(deps, change, surface);
  if (change.kind === 'delete_rows') return confirmDelete(deps, change);
  if (change.kind !== 'start_build' && !isProposalKind(change)) return { ok: false, error: 'This change cannot be confirmed.', change };
  const workspace = WORKSPACE[change.kind];
  if (workspace && !deps.enabledModules.includes(workspace.module)) {
    return { ok: false, error: `The ${workspace.label} workspace is switched off, so this cannot be written.`, change };
  }
  if (change.kind === 'start_build') return confirmBuild(deps, change);

  // An update records the row as it was, read before the write; an insert
  // has no row before it.
  const op = WRITTEN_OP[change.kind];
  const before = op === 'update' ? await valuesOf(deps, toRef(WRITTEN_TABLE[change.kind], updatedId(change))) : null;

  let written: Written;
  try {
    written = await write(deps, change);
  } catch (error) {
    return refusedOrThrow(error, change);
  }
  const subjectRef = toRef(WRITTEN_TABLE[change.kind], written.ref);
  const after = await valuesOf(deps, subjectRef);

  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({
      status: 'done',
      done_at: now(deps),
      subject_ref: subjectRef,
      op,
      before_values: before,
      after_values: after,
      undo: written.undo,
    })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    .select(DASH_CHANGE_SELECT);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (error || rows.length === 0) {
    // Another press got there first, or the mark failed: either way this
    // write is not the change's, so it goes.
    await rollBack(deps, change, written);
    if (error) throw new Error(`Marking the change done failed: ${error.message}`);
    const current = await loadOne(deps, id);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/** Mark a proposed change declined. Nothing else is written. */
export async function declineChange(deps: ChangeDeps, id: string): Promise<ChangeOutcome> {
  const found = await loadPressable(deps, id);
  if (!found) return { ok: false, error: GONE, change: null };
  const { change, surface } = found;
  // A paid press that is running cannot be dismissed: it is already spending.
  if (change.kind === 'paid_action' && change.status === 'proposed' && paidState(change.undo).state === 'running') {
    return { ok: false, error: 'Dash is already running this, so it cannot be dismissed.', change };
  }
  if (change.status !== 'proposed') {
    const error = change.status === 'declined' ? 'You have already declined this change.' : notProposed(change.status);
    return { ok: false, error, change };
  }
  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({ status: 'declined', declined_at: now(deps) })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    // Not while an approval is running it (plan #2228.1).
    .or('undo.is.null,undo->>running_at.is.null')
    .select(DASH_CHANGE_SELECT);
  if (error) throw new Error(`Marking the change declined failed: ${error.message}`);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (rows.length === 0) {
    const current = await loadOne(deps, id, surface);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/**
 * Take a Decline back (plan #1957.3, the toast's Undo): the change is
 * proposed again, nothing having been written for it.
 */
export async function reopenChange(deps: ChangeDeps, id: string): Promise<ChangeOutcome> {
  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({ status: 'proposed', declined_at: null })
    .eq('id', id)
    .eq('user_id', deps.userId)
    .eq('status', 'declined')
    .select(DASH_CHANGE_SELECT);
  if (error) throw new Error(`Putting the change back failed: ${error.message}`);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (rows.length === 0) {
    const current = await loadOne(deps, id);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/**
 * Take a confirmed change back and mark it undone. Refused, with a sentence
 * saying why, once the row it wrote has moved on.
 */
export async function undoChange(deps: ChangeDeps, id: string): Promise<ChangeOutcome> {
  // A change a thread made with one of Dash's write tools is undone here too
  // (plan #1465; undoneByAsk in lib/core/dash-actions.ts).
  // So is one the connector made that touched many rows (plan #1894.5.1;
  // MANY_ROW_KINDS in lib/core/dash-actions.ts), recorded as a routine's.
  let surface: ChangeSurface = 'ask';
  let change = await loadOne(deps, id);
  if (!change) {
    surface = 'thread';
    change = await loadOne(deps, id, surface);
  }
  if (!change) {
    const routine = await loadOne(deps, id, 'routine');
    if (routine && MANY_ROW_KINDS.includes(routine.kind)) {
      surface = 'routine';
      change = routine;
    }
  }
  if (!change) return { ok: false, error: GONE, change: null };
  if (change.status !== 'done' || !change.writtenRef) {
    return { ok: false, error: notConfirmed(change.status), change };
  }

  if (change.kind === 'start_build') return { ok: false, error: BUILD_NO_UNDO, change };
  if (change.kind === 'paid_action') return { ok: false, error: PAID_NO_UNDO, change };
  if (!isProposalKind(change)) return undoWrite(deps, change, surface);

  try {
    await takeBack(deps, change, change.writtenRef);
  } catch (error) {
    return refusedOrThrow(error, change);
  }

  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({ status: 'undone', undone_at: now(deps) })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'done')
    .select(DASH_CHANGE_SELECT);
  if (error) throw new Error(`Marking the change undone failed: ${error.message}`);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (rows.length === 0) {
    const current = await loadOne(deps, id, surface);
    return { ok: false, error: current ? notConfirmed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/**
 * Write one of the four proposal kinds straight away, for Dash acting when
 * asked (plan #1440): the same writer Confirm uses, then the row as it was
 * before and is after, for the record. Refused with a sentence when what it
 * points at can no longer take it; throws only on a failed read or write.
 */
export async function writeChange(
  deps: ChangeDeps,
  change: Extract<NewDashChange, { kind: ProposalChange['kind'] }>,
): Promise<
  | {
      ok: true;
      subjectRef: string;
      op: 'insert' | 'update';
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      undo: Record<string, unknown> | null;
    }
  | { ok: false; error: string }
> {
  const op = WRITTEN_OP[change.kind];
  const pending = change as unknown as ProposalChange;
  const before = op === 'update' ? await valuesOf(deps, toRef(WRITTEN_TABLE[change.kind], updatedId(pending))) : null;
  let written: Written;
  try {
    written = await write(deps, pending);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    throw error;
  }
  const subjectRef = toRef(WRITTEN_TABLE[change.kind], written.ref);
  return { ok: true, subjectRef, op, before, after: await valuesOf(deps, subjectRef), undo: written.undo };
}

/**
 * Undo one of the kinds Dash writes straight away by the one rule
 * (undoDashAction), then reopen the items a ticked-off todo closed with it,
 * where they are still ticked. The record is marked undone by the rule.
 */
async function undoWrite(deps: ChangeDeps, change: DashChange, surface: ChangeSurface): Promise<ChangeOutcome> {
  // A note Dash wrote, edited, renamed or filed: the Undo is a commit too (plan #1894.9.3).
  if (change.kind === 'add_quick_note' || isVaultFileKind(change.kind)) return undoQuickNote(deps, change, surface);
  if (change.kind === 'delete_rows') return undoMany(deps, change, surface, undoDeletedRows);
  if (change.kind === 'change_items') return undoMany(deps, change, surface, undoItemChange);
  if (isShoppingChangeKind(change.kind)) return undoMany(deps, change, surface, undoShoppingChange);
  if (change.kind === 'move_roles') return undoMany(deps, change, surface, undoRoleMove);
  // A todo for each row of a set: the ones still untouched come out (plan #2472.4).
  if (change.kind === 'add_todos') return undoMany(deps, change, surface, undoAddedTodos);
  // A startup added from Find takes its company out again while nothing holds it (plan #1894.6.7).
  if (change.kind === 'add_discovered_company') return undoMany(deps, change, surface, undoDiscoveredCompany);
  // So does a company added from scratch.
  if (change.kind === 'add_company') return undoMany(deps, change, surface, undoAddedCompany);
  // A merge of roles puts back every row it moved or took out (plan #1894.6.2).
  if (change.kind === 'merge_roles') return undoMany(deps, change, surface, undoRoleMerge);
  // So does an email linked, turned down or unlinked (plan #1894.6.5).
  if (change.kind === 'change_role_email') return undoMany(deps, change, surface, undoRoleEmail);
  // A role made from a review email takes the role out again while nothing has come to hang on it (plan #1894.6.4.3).
  if (change.kind === 'add_role_from_email') return undoMany(deps, change, surface, undoRoleFromEmail);
  // A review queue change puts back each row it touched (plan #1894.6.4).
  if ((JOBS_ROWS_KINDS as readonly string[]).includes(change.kind)) return undoMany(deps, change, surface, undoJobsRows);
  // And a contact, a touch or a suggestion marked sent (plan #1894.6.6).
  if (change.kind === 'change_contact' || change.kind === 'change_touch' || change.kind === 'mark_suggestion_sent') {
    return undoMany(deps, change, surface, undoContactRows);
  }
  // And a paste of application questions (plan #1894.6.8).
  if (change.kind === 'add_application_questions') return undoMany(deps, change, surface, undoApplicationQuestions);
  if (change.kind === 'add_interview_round') {
    // The round's row is the record's; its interview is checked here.
    const moved = await roundConversationMoved(deps.db, change.undo);
    if (moved) return { ok: false, error: moved, change };
  }
  const result = await undoDashAction(
    { userId: deps.userId, core: deps.core, db: deps.db, now: deps.now },
    change.id,
    { fromAsk: true },
  );
  if (!result.ok) {
    return { ok: false, error: result.error, change: result.action ? await loadOne(deps, change.id, surface) : null };
  }

  const items = change.undo?.items;
  if (change.kind === 'close_todo' && Array.isArray(items) && items.length > 0) {
    const todo = await deps.db('todo');
    const { error } = await todo
      .from('tasks')
      .update({ status: 'open' })
      .in('id', items.filter((id): id is string => typeof id === 'string'))
      .eq('user_id', deps.userId)
      .eq('status', 'done');
    if (error) console.error(`ask change ${change.id}: reopening the todo's items failed`, error);
  }
  const now = await loadOne(deps, change.id, surface);
  return now ? { ok: true, change: now } : { ok: false, error: GONE, change: null };
}

/**
 * Undo a quick note written to the vault (plan #1894.2): its file comes out of
 * the notes repository as well as its row, the way capture's Undo takes a note
 * back, so the generic rule, which only sees the row, cannot do it.
 */
async function undoQuickNote(deps: ChangeDeps, change: DashChange, surface: ChangeSurface): Promise<ChangeOutcome> {
  if (!deps.undoVaultNote) return { ok: false, error: 'The vault cannot be reached from here, so the note was left.', change };
  const undone = await deps.undoVaultNote({
    id: change.id,
    status: 'done',
    subjectRef: change.writtenRef ? toRef(WRITTEN_TABLE.add_quick_note, change.writtenRef) : null,
    undo: change.undo ?? null,
  });
  if (!undone.ok) return { ok: false, error: undone.error, change };
  const now = await loadOne(deps, change.id, surface);
  return now ? { ok: true, change: now } : { ok: false, error: GONE, change: null };
}

/**
 * Undo many rows changed at once: items (change_items, plan #1656) or roles
 * (move_roles, plan #1657). Every row the record keeps goes back where it
 * still holds what Dash left, then the one record is marked undone, so one
 * press takes the whole change back.
 */
async function undoMany(
  deps: ChangeDeps,
  change: DashChange,
  surface: ChangeSurface,
  putBack: (
    deps: { userId: string; db: AskDb },
    recorded: Record<string, unknown> | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>,
): Promise<ChangeOutcome> {
  const put = await putBack({ userId: deps.userId, db: deps.db }, change.undo);
  if (!put.ok) return { ok: false, error: put.error, change };
  const { data, error } = await deps.core
    .from(DASH_ACTIONS)
    .update({ status: 'undone', undone_at: now(deps) })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'done')
    .select(DASH_CHANGE_SELECT);
  if (error) throw new Error(`Marking the change undone failed: ${error.message}`);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (rows.length === 0) {
    const current = await loadOne(deps, change.id, surface);
    return { ok: false, error: current ? notConfirmed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

import type { GoalsActor, GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertStep, setStepArchived } from '@/lib/goals/steps-store';
import type { ModuleId } from '@/lib/modules';
import { markReturned, unmarkReturned } from '@/lib/returns/mark';
import type { TaskInput } from '@/lib/todo/tasks/input';
import {
  DASH_CHANGE_SELECT,
  toDashChange,
  type DashChange,
  type DashChangeKind,
  type DashChangeStatus,
} from '@/lib/talk/changes';
import type { AskDb, SchemaClient } from './db';

/**
 * Confirming, declining and undoing a change Dash proposed in an Ask Dash
 * answer (plan #1189, feature #1186).
 *
 * Confirm writes the change through the code the page itself uses: a todo
 * through createTask, a step through insertStep on a goals client that records
 * it in goals.history as Dash's, a return through markReturned (the returns
 * page's own). It then marks the change confirmed with the row it wrote, in
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
  /** The person's core client, for core.dash_changes. */
  core: SchemaClient;
  /** The person's client per schema: reads, the undo writes, and the return. */
  db: AskDb;
  /** A goals client recording its writes as `actor`, undoing the history row `undoes`. */
  goals: (history: { actor?: GoalsActor; undoes?: number }) => Promise<GoalsSupabaseClient>;
  /** createTask from lib/todo/tasks/write.ts. */
  createTask: (userId: string, input: TaskInput, timezone: string) => Promise<{ id: string | null; error: string | null }>;
  /** Now, as an ISO timestamp. */
  now?: () => string;
};

/** What the card or the list shows after a press: the change as it now is, or why not. */
export type ChangeOutcome =
  | { ok: true; change: DashChange }
  | { ok: false; error: string; change: DashChange | null };

/** Where each kind's row is shown; in change-view.ts so the client cards can read it. */
export { changeHref } from './change-view';

/** The pages a change lands on, to revalidate after a confirm or an undo. */
export function changePaths(change: DashChange): string[] {
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
  }
}

const WORKSPACE: Record<DashChangeKind, { module: ModuleId; label: string }> = {
  add_todo: { module: 'todo', label: 'Todo' },
  add_goal_step: { module: 'goals', label: 'Goals' },
  mark_returned: { module: 'shopping', label: 'Shopping' },
};

const WRITTEN_TABLE: Record<DashChangeKind, string> = {
  add_todo: 'todo.tasks',
  add_goal_step: 'goals.items',
  mark_returned: 'public.inventory_items',
};

/** A refusal the person reads: the sentence is theirs, the class only marks it as one. */
class Refused extends Error {}

const GONE = 'That change is not there any more.';

function now(deps: ChangeDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

async function loadOne(deps: ChangeDeps, id: string): Promise<DashChange | null> {
  const { data, error } = await deps.core
    .from('dash_changes')
    .select(DASH_CHANGE_SELECT)
    .eq('id', id)
    .eq('user_id', deps.userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the change failed: ${error.message}`);
  return data ? toDashChange(data) : null;
}

/** Why a change in this status cannot be confirmed or declined. */
function notProposed(status: DashChangeStatus): string {
  switch (status) {
    case 'confirmed':
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

type Written = { ref: string; undo: Record<string, unknown> | null };

async function writeTodo(deps: ChangeDeps, change: Extract<DashChange, { kind: 'add_todo' }>): Promise<Written> {
  const input = change.input;
  const { id, error } = await deps.createTask(
    deps.userId,
    { title: input.title, body: input.body, dueOn: input.dueOn, dueTime: input.dueTime, pinned: input.pinned },
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

async function write(deps: ChangeDeps, change: DashChange): Promise<Written> {
  switch (change.kind) {
    case 'add_todo':
      return writeTodo(deps, change);
    case 'add_goal_step':
      return writeGoalStep(deps, change);
    case 'mark_returned':
      return writeReturned(deps, change);
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

async function takeBack(deps: ChangeDeps, change: DashChange, ref: string, force = false): Promise<void> {
  switch (change.kind) {
    case 'add_todo':
      return undoTodo(deps, change, ref, force);
    case 'add_goal_step':
      return undoGoalStep(deps, ref, force);
    case 'mark_returned':
      return undoReturned(deps, change, force);
  }
}

/** Take back a write whose confirm did not stick. Best effort: the error that stopped the confirm is the one that matters. */
async function rollBack(deps: ChangeDeps, change: DashChange, written: Written): Promise<void> {
  try {
    await takeBack(deps, { ...change, undo: written.undo } as DashChange, written.ref, true);
  } catch (error) {
    console.error(`ask change ${change.id}: taking back ${written.ref} failed`, error);
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
 * Write a proposed change and mark it confirmed. Refused, with the change as
 * it stands, when it is not a proposal any more, its answer is still being
 * written, its workspace is off, or what it points at can no longer take it.
 */
export async function confirmChange(deps: ChangeDeps, id: string): Promise<ChangeOutcome> {
  const change = await loadOne(deps, id);
  if (!change) return { ok: false, error: GONE, change: null };
  if (change.status !== 'proposed') return { ok: false, error: notProposed(change.status), change };
  if (!change.turnId) {
    return { ok: false, error: 'Dash is still writing this answer. Try again once it has finished.', change };
  }
  const workspace = WORKSPACE[change.kind];
  if (!deps.enabledModules.includes(workspace.module)) {
    return { ok: false, error: `The ${workspace.label} workspace is switched off, so this cannot be written.`, change };
  }

  let written: Written;
  try {
    written = await write(deps, change);
  } catch (error) {
    return refusedOrThrow(error, change);
  }

  const { data, error } = await deps.core
    .from('dash_changes')
    .update({
      status: 'confirmed',
      confirmed_at: now(deps),
      written_table: WRITTEN_TABLE[change.kind],
      written_ref: written.ref,
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
    if (error) throw new Error(`Marking the change confirmed failed: ${error.message}`);
    const current = await loadOne(deps, id);
    return { ok: false, error: current ? notProposed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

/** Mark a proposed change declined. Nothing else is written. */
export async function declineChange(deps: ChangeDeps, id: string): Promise<ChangeOutcome> {
  const change = await loadOne(deps, id);
  if (!change) return { ok: false, error: GONE, change: null };
  if (change.status !== 'proposed') {
    const error = change.status === 'declined' ? 'You have already declined this change.' : notProposed(change.status);
    return { ok: false, error, change };
  }
  const { data, error } = await deps.core
    .from('dash_changes')
    .update({ status: 'declined', declined_at: now(deps) })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'proposed')
    .select(DASH_CHANGE_SELECT);
  if (error) throw new Error(`Marking the change declined failed: ${error.message}`);
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
  const change = await loadOne(deps, id);
  if (!change) return { ok: false, error: GONE, change: null };
  if (change.status !== 'confirmed' || !change.writtenRef) {
    return { ok: false, error: notConfirmed(change.status), change };
  }

  try {
    await takeBack(deps, change, change.writtenRef);
  } catch (error) {
    return refusedOrThrow(error, change);
  }

  const { data, error } = await deps.core
    .from('dash_changes')
    .update({ status: 'undone', undone_at: now(deps) })
    .eq('id', change.id)
    .eq('user_id', deps.userId)
    .eq('status', 'confirmed')
    .select(DASH_CHANGE_SELECT);
  if (error) throw new Error(`Marking the change undone failed: ${error.message}`);
  const rows = (data ?? []) as Parameters<typeof toDashChange>[0][];
  if (rows.length === 0) {
    const current = await loadOne(deps, id);
    return { ok: false, error: current ? notConfirmed(current.status) : GONE, change: current };
  }
  return { ok: true, change: toDashChange(rows[0]) };
}

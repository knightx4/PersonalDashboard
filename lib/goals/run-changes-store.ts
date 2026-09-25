import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  HISTORY_COLUMNS,
  changeLines,
  emptyNames,
  fieldsAfterUndo,
  findUndoable,
  namesNeeded,
  targetState,
  type ChangeLine,
  type ChangeNames,
  type HistoryRow,
  type UndoTarget,
} from '@/lib/goals/run-changes';

/**
 * Reads and writes for a run's page (plan #1013). The rules are in
 * lib/goals/run-changes.ts; this file reads the history they need and carries
 * out an undo.
 *
 * Every read goes through the signed-in client, so row level security keeps
 * it to your own history. Each undo write goes through a client made for that
 * one change (createGoalsClient({ undoes, undoesField })), so the history row
 * it leaves is yours and names the change it took back.
 */

/** Ids per request, to keep the query string short. */
const CHUNK = 100;

/** Far past what one run writes; stops a runaway run from making the page unreadable. */
const RUN_ROWS_LIMIT = 2000;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

async function runHistory(client: GoalsSupabaseClient, runId: string): Promise<HistoryRow[]> {
  const { data, error } = await client
    .from('history')
    .select(HISTORY_COLUMNS)
    .eq('run_id', runId)
    .order('id', { ascending: true })
    .limit(RUN_ROWS_LIMIT);
  if (error) throw new Error(`Could not read what the run changed: ${error.message}`);
  return (data ?? []) as HistoryRow[];
}

/** Every history row on the rows the run touched, written after the run's first change. */
async function laterHistory(
  client: GoalsSupabaseClient,
  rows: readonly HistoryRow[],
): Promise<HistoryRow[]> {
  if (rows.length === 0) return [];
  const first = Math.min(...rows.map((r) => r.id));
  const ids = [...new Set(rows.map((r) => r.row_id))];
  const out: HistoryRow[] = [];
  for (const part of chunks(ids)) {
    const { data, error } = await client
      .from('history')
      .select(HISTORY_COLUMNS)
      .in('row_id', part)
      .gt('id', first)
      .order('id', { ascending: true });
    if (error) throw new Error(`Could not read what changed since: ${error.message}`);
    // The run's own later writes are included: a column it set twice is
    // compared against the second write.
    out.push(...((data ?? []) as HistoryRow[]));
  }
  return out;
}

async function loadNames(
  client: GoalsSupabaseClient,
  rows: readonly HistoryRow[],
): Promise<ChangeNames> {
  const names = emptyNames();
  const needed = namesNeeded(rows);

  for (const part of chunks(needed.records)) {
    const { data, error } = await client.from('records').select('id, collection_id').in('id', part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string; collection_id: string }[]) {
      names.records.set(r.id, r.collection_id);
      needed.collections.push(r.collection_id);
    }
  }
  for (const part of chunks([...new Set(needed.collections)])) {
    const { data, error } = await client.from('collections').select('id, name').in('id', part);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { id: string; name: string }[])
      names.collections.set(c.id, c.name);
  }
  for (const part of chunks(needed.items)) {
    const { data, error } = await client
      .from('items')
      .select('id, title, level, kind')
      .in('id', part);
    if (error) throw new Error(error.message);
    for (const i of (data ?? []) as {
      id: string;
      title: string;
      level: string;
      kind: string | null;
    }[]) {
      names.items.set(i.id, { title: i.title, level: i.level, kind: i.kind });
    }
  }
  return names;
}

/** What one run changed, as the lines its page shows. */
export async function loadRunChanges(
  client: GoalsSupabaseClient,
  runId: string,
): Promise<ChangeLine[]> {
  const rows = await runHistory(client, runId);
  const [later, names] = await Promise.all([laterHistory(client, rows), loadNames(client, rows)]);
  return changeLines(rows, later, names);
}

/** Carry out one target's write. False when the row was not there to change. */
async function undoTarget(client: GoalsSupabaseClient, target: UndoTarget): Promise<boolean> {
  switch (target.kind) {
    case 'archive': {
      const { data, error } = await client
        .from(target.table)
        .update({ archived_at: new Date().toISOString() })
        .eq('id', target.rowId)
        .is('archived_at', null)
        .select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    }
    case 'delete': {
      const { data, error } = await client
        .from(target.table)
        .delete()
        .eq('id', target.rowId)
        .select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    }
    case 'revert': {
      const { data, error } = await client
        .from(target.table)
        .update(target.values)
        .eq('id', target.rowId)
        .select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    }
    case 'field': {
      const { data: current, error: readError } = await client
        .from('collections')
        .select('fields')
        .eq('id', target.rowId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!current) return false;
      const { data, error } = await client
        .from('collections')
        .update({ fields: fieldsAfterUndo((current as { fields: unknown }).fields, target) })
        .eq('id', target.rowId)
        .select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    }
  }
}

export type UndoOutcome = { ok: true; undone: number; kept: number } | { ok: false; error: string };

/**
 * Undo one line of a run's changes. The lines are read again first, so a
 * change that has moved on since the page was drawn is refused rather than
 * written over, and each target of a grouped line ("Filed 4 loans") is
 * checked on its own: the ones you have confirmed or edited are kept.
 *
 * `clientFor` makes the client each write goes through, carrying the change
 * it undoes, so the history trigger records the undo against it.
 */
export async function undoRunChange(
  client: GoalsSupabaseClient,
  clientFor: (target: UndoTarget) => Promise<GoalsSupabaseClient>,
  runId: string,
  key: string,
): Promise<UndoOutcome> {
  const rows = await runHistory(client, runId);
  const [later, names] = await Promise.all([laterHistory(client, rows), loadNames(client, rows)]);
  const line = findUndoable(changeLines(rows, later, names), key);
  if (!line)
    return {
      ok: false,
      error: 'That change can no longer be undone. Reload to see where it stands.',
    };

  let undone = 0;
  let kept = 0;
  for (const target of line.targets) {
    if (targetState(target, later).state !== 'undoable') {
      kept += 1;
      continue;
    }
    if (await undoTarget(await clientFor(target), target)) undone += 1;
    else kept += 1;
  }
  return { ok: true, undone, kept };
}

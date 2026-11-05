'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { liveFields } from '@/lib/goals/collections';
import { loadCollection, loadRecords, updateRecord } from '@/lib/goals/collections-store';
import { rearrangeGoalDashboard } from '@/lib/goals/dashboard-store';
import { formValues } from '@/lib/goals/information';
import { addListRow } from '@/lib/goals/lists-store';
import { parseNumber } from '@/lib/goals/readings';

/**
 * The writes a goal's dashboard tiles make (plan #2778.2): a tile's quick
 * add puts a row on the list it reads or logs a new value of a tracked field,
 * which the database keeps as a dated reading; a tile's menu moves it one
 * place or takes it off the dashboard. Each returns a sentence to show rather
 * than throwing, and the database writes the history.
 */

export type TileActionState = {
  error?: string;
  /** The field key the error belongs beside, or absent for the form as a whole. */
  field?: string;
  done?: number;
};

const Id = z.string().uuid();
const Index = z.coerce.number().int().min(0).max(100);

function saved(goalId: string): TileActionState {
  revalidatePath(`/goals/${goalId}`);
  return { done: Date.now() };
}

/** Add a row to the list a tile reads: `goalId`, `listId` and the values, named as the record form names them. */
// latency: pending
export async function addTileRowAction(_prev: TileActionState, form: FormData): Promise<TileActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  const listId = Id.safeParse(form.get('listId'));
  if (!goalId.success || !listId.success) return { error: 'Could not tell which list that was.' };
  try {
    const client = await createGoalsClient();
    const list = await loadCollection(client, listId.data);
    if (!list) return { error: 'That list is gone. Reload to see what is there.' };
    const values = formValues(list.fields, (name) => form.get(name));
    const filled = Object.values(values).some((v) => typeof v === 'string' && v.trim() !== '');
    if (!filled) return { error: 'Fill in at least one field.' };
    const added = await addListRow(client, user.id, listId.data, values);
    if (!added.ok) return { error: added.error, ...(added.field ? { field: added.field } : {}) };
  } catch {
    return { error: 'The row could not be added. Try again.' };
  }
  return saved(goalId.data);
}

/** The prefix of each row's input in the log form: `value:<recordId>`. */
const VALUE_OF = 'value:';

/**
 * Log new values of a tracked field: `goalId`, `listId`, `field`, and a
 * `value:<recordId>` for each row of the list, starting at its value now.
 * Each row whose value was typed over keeps the new value, and the database
 * writes it as a reading dated today, so the chart gains a point. Rows left
 * as they were are not touched. A refusal names its row as `value:<recordId>`.
 */
// latency: pending
export async function logTileReadingAction(_prev: TileActionState, form: FormData): Promise<TileActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  const listId = Id.safeParse(form.get('listId'));
  if (!goalId.success || !listId.success) return { error: 'Could not tell which list that was.' };
  const key = form.get('field');
  try {
    const client = await createGoalsClient();
    const list = await loadCollection(client, listId.data);
    const field = list ? liveFields(list.fields).find((f) => f.key === key && f.tracked) : undefined;
    if (!list || !field) return { error: 'That list no longer tracks this. Reload to see it.' };
    const rows = await loadRecords(client, listId.data);
    const changed: { id: string; raw: string }[] = [];
    for (const [name, value] of form.entries()) {
      if (!name.startsWith(VALUE_OF) || typeof value !== 'string') continue;
      const id = name.slice(VALUE_OF.length);
      const row = rows.find((r) => r.id === id);
      if (!row) return { error: 'One of those is gone from the list. Reload to see it.' };
      const raw = value.trim();
      // The box starts at the value as it reads ("$52,000"), so a value left as it was is not logged again.
      if (raw === '' || parseNumber(raw) === row.data[field.key]) continue;
      changed.push({ id, raw });
    }
    if (changed.length === 0) return { error: 'Type a new value over one of them first.' };
    for (const { id, raw } of changed) {
      const result = await updateRecord(client, id, { [field.key]: raw });
      if (!result.ok) return { error: result.error, field: `${VALUE_OF}${id}` };
    }
  } catch {
    return { error: 'The values could not be saved. Try again.' };
  }
  return saved(goalId.data);
}

/** Move a tile one place: `goalId`, `index` and `by` (-1 earlier, 1 later). */
// latency: pending
export async function moveTileAction(form: FormData): Promise<TileActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  const index = Index.safeParse(form.get('index'));
  const by = form.get('by') === '-1' ? -1 : form.get('by') === '1' ? 1 : null;
  if (!goalId.success || !index.success || by === null) return { error: 'Could not tell which tile that was.' };
  try {
    const moved = await rearrangeGoalDashboard(await createGoalsClient(), user.id, goalId.data, {
      kind: 'move',
      index: index.data,
      by,
    });
    if (!moved) return { error: 'That tile has moved since. Reload to see the dashboard.' };
  } catch {
    return { error: 'The tile could not be moved. Try again.' };
  }
  return saved(goalId.data);
}

/** Take a tile off the dashboard: `goalId` and `index`. What it read is left as it is. */
// latency: pending
export async function removeTileAction(form: FormData): Promise<TileActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  const index = Index.safeParse(form.get('index'));
  if (!goalId.success || !index.success) return { error: 'Could not tell which tile that was.' };
  try {
    const removed = await rearrangeGoalDashboard(await createGoalsClient(), user.id, goalId.data, {
      kind: 'remove',
      index: index.data,
    });
    if (!removed) return { error: 'That tile has gone already. Reload to see the dashboard.' };
  } catch {
    return { error: 'The tile could not be removed. Try again.' };
  }
  return saved(goalId.data);
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadCollectionsForGoal } from '@/lib/goals/collections-store';
import {
  numberFromChoices,
  parseMeasureFields,
  parseNumberFrom,
  parseReadingFields,
} from '@/lib/goals/readings';
import { addReading, deleteReading, setGoalMeasure, setNumberFrom } from '@/lib/goals/readings-store';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * The writes for a goal's number (plan #930): name its unit and target, add
 * a reading, remove one entered by mistake, and work the number out from a
 * collection (plan #1024). Each returns a sentence to
 * show rather than throwing; the history is written by the database.
 */

export type ReadingActionState = { error?: string; done?: number };

const Id = z.string().uuid();

function saved(): ReadingActionState {
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

// latency: pending
export async function setMeasureAction(
  _prev: ReadingActionState,
  form: FormData,
): Promise<ReadingActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  const parsed = parseMeasureFields((key) => form.get(key));
  if (!parsed.ok) return { error: parsed.error };
  try {
    const changed = await setGoalMeasure(await createGoalsClient(), goalId.data, parsed.value);
    if (!changed) return { error: 'That goal is no longer on the page.' };
  } catch {
    return { error: 'The unit could not be saved. Try again.' };
  }
  return saved();
}

// latency: pending
export async function addReadingAction(
  _prev: ReadingActionState,
  form: FormData,
): Promise<ReadingActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  const account = await loadAccountSettings(user.id);
  const parsed = parseReadingFields((key) => form.get(key), todayIn(account.timezone));
  if (!parsed.ok) return { error: parsed.error };
  try {
    const id = await addReading(await createGoalsClient(), user.id, goalId.data, parsed.value);
    if (!id) return { error: 'That goal no longer takes readings. Reload to see it.' };
  } catch {
    return { error: 'The reading could not be saved. Try again.' };
  }
  return saved();
}

// latency: pending
export async function deleteReadingAction(form: FormData): Promise<ReadingActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which reading that was.' };
  try {
    const removed = await deleteReading(await createGoalsClient(), id.data);
    if (!removed) return { error: 'That reading has already gone. Reload to see it.' };
  } catch {
    return { error: 'The reading could not be removed. Try again.' };
  }
  return saved();
}

// latency: pending
export async function setNumberFromAction(
  _prev: ReadingActionState,
  form: FormData,
): Promise<ReadingActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  try {
    const client = await createGoalsClient();
    // Only a collection serving this goal can be picked.
    const choices = numberFromChoices(await loadCollectionsForGoal(client, goalId.data));
    const parsed = parseNumberFrom(form.get('from'), choices);
    if (!parsed.ok) return { error: parsed.error };
    const choice = parsed.value;
    const changed = await setNumberFrom(client, goalId.data, choice?.from ?? null, choice?.unit ?? null);
    if (!changed) return { error: 'That goal is no longer on the page.' };
  } catch {
    return { error: 'Where the number comes from could not be saved. Try again.' };
  }
  return saved();
}

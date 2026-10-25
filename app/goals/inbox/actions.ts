'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { snoozeRow, unsnoozeRow } from '@/lib/core/inbox-snooze-store';
import { dayStartIn, snoozeDay } from '@/lib/core/snooze-days';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { snoozeRefOf } from '@/lib/goals/inbox-snooze';
import { leaveQuestions } from '@/lib/goals/shaping-store';
import type { TodayKind } from '@/lib/goals/today';
import { formatDay } from '@/lib/goals/dates';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * Snooze on the Goals Inbox (plan #1844): put a row aside until tomorrow, next
 * week or a picked day, and bring it back. The row is named by its kind and id,
 * and the ref it is snoozed under is worked out here, so a form cannot snooze
 * anything the Inbox does not show.
 */

export type SnoozeState = { error?: string; message?: string };

const Id = z.string().uuid();
const Kind = z.string().min(1).max(20);

function target(form: FormData): string | null {
  const id = Id.safeParse(form.get('id'));
  const kind = Kind.safeParse(form.get('kind'));
  if (!id.success || !kind.success) return null;
  return snoozeRefOf(kind.data as TodayKind, id.data);
}

// latency: optimistic
export async function snoozeInboxRowAction(form: FormData): Promise<SnoozeState> {
  const user = await requireUser();
  const ref = target(form);
  if (!ref) return { error: 'That row cannot be snoozed.' };

  const account = await loadAccountSettings(user.id);
  const day = snoozeDay(String(form.get('choice') ?? ''), todayIn(account.timezone));
  if (!day) return { error: 'Pick a day after today.' };

  const outcome = await snoozeRow(await createClient(), {
    userId: user.id,
    ref,
    until: dayStartIn(day, account.timezone),
  });
  if (outcome.error) return { error: outcome.error };
  revalidatePath('/goals', 'layout');
  // The toast puts "Later:" and the row's title in front (plan #1957.8).
  return { message: `until ${formatDay(day)}.` };
}

/** Undo a snooze: the row is back at once. */
// latency: optimistic
export async function unsnoozeInboxRowAction(form: FormData): Promise<SnoozeState> {
  const user = await requireUser();
  const ref = target(form);
  if (!ref) return { error: 'That row cannot be snoozed.' };
  const outcome = await unsnoozeRow(await createClient(), { userId: user.id, ref });
  if (outcome.error) return { error: outcome.error };
  revalidatePath('/goals', 'layout');
  return { message: 'Brought back.' };
}

/**
 * Leave them as they are, on a goal's questions folded into one Inbox row:
 * every one still unanswered closes with things staying as they were, and
 * the row goes. The ids come from the row; the update only touches open
 * questions the signed-in account owns.
 */
// latency: pending
export async function leaveQuestionsAction(form: FormData): Promise<SnoozeState> {
  await requireUser();
  const ids = z.array(Id).min(1).max(100).safeParse(form.getAll('id'));
  if (!ids.success) return { error: 'Could not tell which questions those were.' };
  try {
    const closed = await leaveQuestions(await createGoalsClient(), ids.data);
    if (closed === 0) return { error: 'Those questions were already answered.' };
    revalidatePath('/goals', 'layout');
    return { message: closed === 1 ? 'Left 1 question as it was.' : `Left ${closed} questions as they were.` };
  } catch {
    return { error: 'Could not close those questions. Try again.' };
  }
}

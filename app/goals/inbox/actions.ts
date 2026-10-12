'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { snoozeRow, unsnoozeRow } from '@/lib/core/inbox-snooze-store';
import { dayStartIn, snoozeDay } from '@/lib/core/snooze-days';
import { snoozeRefOf } from '@/lib/goals/inbox-snooze';
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
  return { message: `Snoozed until ${formatDay(day)}.` };
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

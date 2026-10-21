'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { LATER_REFUSED, laterUntil, untilWords } from '@/lib/core/snooze-days';
import { setWaitingDismissal } from '@/lib/jobs/today/waiting';
import { saveReminderEdit } from '@/lib/jobs/today/reminders';

/**
 * Later's day, from the one Later menu (plan #1957.9): one of
 * lib/core/snooze-days.ts's choices or a day picked, read in the account's
 * zone. Null when the day is not after today.
 */
async function laterFor(userId: string, choice: string): Promise<{ until: string; words: string } | null> {
  const { timezone } = await loadAccountSettings(userId);
  const later = laterUntil(choice, timezone);
  return later ? { until: later.until.toISOString(), words: untilWords(later.day, timezone) } : null;
}

/**
 * Done with a nudge.
 *
 * Completed rather than deleted: the reminder rules are keyed on `rule_key` and
 * an insert that collides is a no-op, so a deleted reminder would come straight
 * back on the next sweep. A completed one stays out of the way for good.
 */
// latency: pending -- should be optimistic: a tick that waits for the round trip
export async function completeReminder(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await saveReminderEdit(supabase, user.id, id, { completed_at: new Date().toISOString() });

  if (error) return { error };
  revalidatePath('/jobs');
  // A to-do added from the role page's timeline is also shown there, so
  // finishing it here has to clear it there too.
  revalidatePath('/jobs/roles/[id]', 'page');
  // And on the company, which rolls up the to-dos of every role it has.
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

/**
 * The toast's Undo on Done or Later (plan #1957.3): puts the nudge back as it
 * was, open and due when it was due.
 */
// latency: pending
export async function restoreReminder(
  id: string,
  dueAt: string | null,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update(dueAt ? { completed_at: null, due_at: dueAt } : { completed_at: null })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

/**
 * Not now. Pushes the nudge out to the day chosen rather than deciding
 * anything about it, and hands back when it was due so the toast's Undo can
 * put it back, with when it comes back in words for the toast.
 */
// latency: pending -- should be optimistic: a snooze that waits for the round trip
export async function snoozeReminder(
  id: string,
  choice: string,
): Promise<{ error: string | null; dueAt?: string | null; until?: string }> {
  const user = await requireUser();
  const later = await laterFor(user.id, choice);
  if (!later) return { error: LATER_REFUSED };
  const supabase = await createClient();

  const { data: before } = await supabase
    .from('reminders')
    .select('due_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  const { error } = await saveReminderEdit(supabase, user.id, id, { due_at: later.until });

  if (error) return { error };
  revalidatePath('/jobs');
  revalidatePath('/jobs/roles/[id]', 'page');
  // And on the company, which rolls up the to-dos of every role it has.
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null, dueAt: (before?.due_at as string | null | undefined) ?? null, until: later.words };
}

/**
 * Answer a request waiting on you: `until: null` is dealt with, for good; a
 * date is Later, the same distinction reminders draw with completed_at vs
 * due_at (lib/jobs/today/waiting.ts writes it).
 */
async function dismissWaiting(
  eventId: string,
  until: string | null,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await setWaitingDismissal(supabase, user.id, eventId, until);
  if (error) return { error };
  revalidatePath('/jobs');
  revalidatePath('/jobs/inbox');
  return { error: null };
}

// latency: pending -- should be optimistic: a tick that waits for the round trip
export async function completeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismissWaiting(eventId, null);
}

/** Later on a request, to the day chosen from the one Later menu. */
// latency: pending -- should be optimistic: a snooze that waits for the round trip
export async function snoozeWaiting(eventId: string, choice: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const later = await laterFor(user.id, choice);
  if (!later) return { error: LATER_REFUSED };
  return dismissWaiting(eventId, later.until);
}

/**
 * The toast's Undo on a "Waiting on you" row (plan #1957.3). The row is
 * recomputed from the event log, so taking the dismissal away is what brings
 * it back.
 */
// latency: pending
export async function restoreWaiting(eventId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('waiting_dismissals')
    .delete()
    .eq('user_id', user.id)
    .eq('application_event_id', eventId);

  if (error) return { error: error.message };
  revalidatePath('/jobs');
  return { error: null };
}

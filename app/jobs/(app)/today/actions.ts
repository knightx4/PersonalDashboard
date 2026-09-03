'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { SNOOZE_DAYS } from '@/lib/jobs/today/load';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Done with a nudge.
 *
 * Completed rather than deleted: the reminder rules are keyed on `rule_key` and
 * an insert that collides is a no-op, so a deleted reminder would come straight
 * back on the next sweep. A completed one stays out of the way for good.
 */
export async function completeReminder(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  // A to-do added from the role page's timeline is also shown there, so
  // finishing it here has to clear it there too.
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/** Not now. Pushes the nudge out rather than deciding anything about it. */
export async function snoozeReminder(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update({ due_at: new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/**
 * Dismiss a "Waiting on you" row on This week.
 *
 * It has no row of its own to mark done -- it is recomputed from the event log
 * on every load -- so the dismissal lives in its own small table instead,
 * upserted so re-dismissing an already-dismissed row just updates it rather
 * than erroring. `until: null` is "Done", for good; a date is "Later", the
 * same distinction reminders draw with completed_at vs due_at.
 */
async function dismissWaiting(
  eventId: string,
  until: string | null,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('waiting_dismissals')
    .upsert(
      { user_id: user.id, application_event_id: eventId, dismissed_until: until },
      { onConflict: 'user_id,application_event_id' },
    );

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  return { error: null };
}

export async function completeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismissWaiting(eventId, null);
}

export async function snoozeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismissWaiting(eventId, new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString());
}

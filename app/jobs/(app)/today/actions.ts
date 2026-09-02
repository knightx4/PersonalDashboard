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
 * Dismiss a "Waiting on you" or "About to go quiet" row on This week.
 *
 * Neither has a row of its own to mark done -- both are recomputed from the
 * event log and the pipeline on every load -- so the dismissal lives in its
 * own small table instead, upserted so re-dismissing an already-dismissed row
 * just updates it rather than erroring. `until: null` is "Done", for good;
 * a date is "Later", the same distinction reminders draw with completed_at
 * vs due_at.
 */
async function dismiss(
  table: 'waiting_dismissals' | 'quiet_dismissals',
  column: 'application_event_id' | 'application_id',
  id: string,
  until: string | null,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from(table)
    .upsert(
      { user_id: user.id, [column]: id, dismissed_until: until },
      { onConflict: `user_id,${column}` },
    );

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  return { error: null };
}

export async function completeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismiss('waiting_dismissals', 'application_event_id', eventId, null);
}

export async function snoozeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismiss(
    'waiting_dismissals',
    'application_event_id',
    eventId,
    new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString(),
  );
}

export async function completeQuiet(applicationId: string): Promise<{ error: string | null }> {
  return dismiss('quiet_dismissals', 'application_id', applicationId, null);
}

export async function snoozeQuiet(applicationId: string): Promise<{ error: string | null }> {
  return dismiss(
    'quiet_dismissals',
    'application_id',
    applicationId,
    new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString(),
  );
}

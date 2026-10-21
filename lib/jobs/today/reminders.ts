import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Changing a reminder: Jobs Today's Done and Later, the role timeline's edit
 * and its email link, and Dash's change_reminder all write through here
 * (plan #2473.2).
 *
 * A reminder is finished, never deleted: the reminder rules are keyed on
 * `rule_key`, and a deleted one would come straight back on the next sweep.
 * `rule_key` is never touched, so a sweep's reminder is edited as freely as a
 * hand-written one.
 */

export type ReminderEdit = {
  completed_at?: string | null;
  due_at?: string;
  body?: string;
  ingested_message_id?: string | null;
};

/** Write `update` onto one of the person's reminders and return it as it now is. */
export async function saveReminderEdit(
  supabase: AppSupabaseClient,
  userId: string,
  reminderId: string,
  update: ReminderEdit,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('reminders')
    .update(update)
    .eq('id', reminderId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Record<string, unknown> | null) ?? null, error: null };
}

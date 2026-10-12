/**
 * Auto approve: the runner's switch that says yes to every proposal.
 *
 * With it on, a feature or step a session writes as `proposed` goes in as
 * `not_started`, so the runner can take it without waiting for a press. The
 * yes itself is a trigger on `plan_items` (migration 0191), because sessions
 * write proposals straight through SQL. What lives here is reading the switch
 * and flipping it, and approving whatever was already proposed when it goes on.
 *
 * Kept off `OvernightRun` though it is a column on the same row: it is a
 * standing setting rather than part of the night, and the night's readers do
 * not need it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/** Whether the account has auto approve on. Off when there is no row or the read fails. */
export async function loadAutoApprove(supabase: Db, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('plan_overnight_runs')
    .select('auto_approve')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error(`plan_overnight_runs.auto_approve could not be read: ${error.message}`);
    return false;
  }
  return data?.auto_approve === true;
}

/**
 * Turn auto approve on or off.
 *
 * An upsert, because an account that has never started the runner has no row
 * yet; the row it writes has the runner off. Turning it on also approves every
 * row already proposed, since the trigger only sees rows as they are written.
 * Returns how many rows that approved.
 */
export async function setAutoApprove(input: {
  supabase: Db;
  userId: string;
  on: boolean;
}): Promise<{ approved: number; error: string | null }> {
  const { error } = await input.supabase
    .from('plan_overnight_runs')
    .upsert({ user_id: input.userId, auto_approve: input.on }, { onConflict: 'user_id' });
  if (error) return { approved: 0, error: error.message };
  if (!input.on) return { approved: 0, error: null };

  const approved = await input.supabase
    .from('plan_items')
    .update({ status: 'not_started' })
    .eq('user_id', input.userId)
    .eq('status', 'proposed')
    .select('id');
  if (approved.error) return { approved: 0, error: approved.error.message };
  return { approved: approved.data?.length ?? 0, error: null };
}

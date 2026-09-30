'use server';

import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { planRoutine } from '@/lib/feedback/routine';
import { ciFixRunning, ciFixText, CI_FIX_HOLD_MS } from '@/lib/plan/ci-fix';
import { startRoutineRun } from '@/lib/plan/runs';
import { loadMainCheck } from '@/lib/shell/main-check';

export type CiFixState = { error?: string; message?: string };

/**
 * Send red CI on main to Dash (note 06016ffa): the button in the panel behind
 * the status line's dot.
 *
 * The failure is read again from the stored reading rather than taken from the
 * page, so a press on a panel left open after main went green starts nothing.
 * A press within the hour of another is refused, because two sessions fixing
 * the same failure only race each other to main.
 */
// latency: pending
export async function sendCiFixToDash(): Promise<CiFixState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const check = await loadMainCheck();
  if (check?.conclusion !== 'failed') {
    return { error: 'Main is not red on the latest reading, so there is nothing to fix.' };
  }

  const { data: recent } = await supabase
    .from('plan_runs')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('job', 'ci_fix')
    .eq('status', 'started')
    .gte('created_at', new Date(Date.now() - CI_FIX_HOLD_MS).toISOString());
  const startedAt = ((recent ?? []) as Array<{ created_at: string }>).map((r) => r.created_at);
  if (ciFixRunning(startedAt, Date.now())) {
    return { error: 'Dash is already on this. Give that run the hour before sending another.' };
  }

  const result = await startRoutineRun({
    supabase,
    userId: user.id,
    job: 'ci_fix',
    routine: planRoutine(),
    text: ciFixText(check),
  });
  if (!result.ok) return { error: result.error };
  return { message: 'Dash is on it. The dot turns green once the fix reaches main.' };
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { planRoutine } from '@/lib/feedback/routine';
import {
  CHECK_BACK_COLUMNS,
  checkBackFrom,
  chooseWake,
  wakeDayStart,
  wakeTurn,
  WAKE_GRACE_MS,
} from '@/lib/plan/check-backs';
import { startRoutineRun } from '@/lib/plan/runs';
import { createServiceSupabase } from '@/inngest/supabase-admin';

/**
 * Waking Dash for check-backs nobody picked up (supabase/migrations/0103).
 *
 * Run by the four-minute tick (app/api/cron/overnight). Most ticks find
 * nothing: a check-back is usually closed by whichever Dash session runs next,
 * which reads the due ones before anything else. This is for the ones still
 * waiting an hour past due. One session per account takes every one that is
 * due, at most `WAKES_PER_DAY` sessions a day.
 *
 * `woke_at` is claimed before the routine is fired, so two ticks that overlap
 * cannot both start a session for one check-back. A fire that fails is not
 * retried: the check-back stays waiting, still listed for the next session to
 * run, and the failure is in `plan_runs` like any other.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type CheckBackWakeReport = {
  woken: { userId: string; checkBacks: number; started: boolean; error: string | null }[];
};

export async function runCheckBackWake(deps?: { supabase?: Db; now?: number }): Promise<CheckBackWakeReport> {
  const supabase = deps?.supabase ?? (createServiceSupabase() as Db);
  const now = deps?.now ?? Date.now();
  const report: CheckBackWakeReport = { woken: [] };

  const { data, error } = await supabase
    .from('check_backs')
    .select(CHECK_BACK_COLUMNS)
    .eq('status', 'waiting')
    .eq('wake', true)
    .is('woke_at', null)
    .lte('due_at', new Date(now - WAKE_GRACE_MS).toISOString())
    .order('due_at')
    .limit(50);
  if (error) throw new Error(`Reading due check-backs failed: ${error.message}`);
  const overdue = (data ?? []).map((row) => checkBackFrom(row as Record<string, unknown>));
  if (overdue.length === 0) return report;

  const routine = planRoutine();
  if (!routine.token) return report;

  const byUser = new Map<string, typeof overdue>();
  for (const row of overdue) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

  for (const [userId, rows] of byUser) {
    const { count } = await supabase
      .from('plan_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('job', 'check_back')
      .gte('created_at', new Date(wakeDayStart(now)).toISOString());
    const chosen = chooseWake(rows, count ?? 0, now);
    if (chosen.length === 0) continue;

    const claimed = await supabase
      .from('check_backs')
      .update({ woke_at: new Date(now).toISOString() })
      .in(
        'id',
        chosen.map((row) => row.id),
      )
      .is('woke_at', null)
      .select('id');
    if (claimed.error) throw new Error(`Claiming check-backs failed: ${claimed.error.message}`);
    const claimedIds = new Set(((claimed.data ?? []) as { id: string }[]).map((row) => row.id));
    const mine = chosen.filter((row) => claimedIds.has(row.id));
    if (mine.length === 0) continue;

    const started = await startRoutineRun({
      supabase,
      userId,
      job: 'check_back',
      routine,
      planItemId: mine.length === 1 ? mine[0]!.planItemId : null,
      text: wakeTurn(mine),
    });

    if (started.ok) {
      const run = await supabase
        .from('plan_runs')
        .select('id')
        .eq('user_id', userId)
        .eq('job', 'check_back')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const runId = (run.data as { id: string } | null)?.id;
      if (runId) {
        await supabase
          .from('check_backs')
          .update({ woke_run_id: runId })
          .in(
            'id',
            mine.map((row) => row.id),
          );
      }
    }

    report.woken.push({
      userId,
      checkBacks: mine.length,
      started: started.ok,
      error: started.ok ? null : started.error,
    });
  }

  return report;
}

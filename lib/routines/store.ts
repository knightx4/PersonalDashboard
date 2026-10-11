import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { Routine } from './registry';
import { runKey, type RoutineFacts, type RunFact, type ScheduleFact } from './view';

/**
 * The facts a Routines page joins with the registry: the pg_cron jobs, through
 * public.routine_schedules() (owner only), and the latest run of each routine
 * that records one, from plan_runs or goals.runs. Row level security keeps the
 * runs to the signed-in person's own.
 *
 * A failed read of the jobs leaves `schedules` null, so the page falls back to
 * the expressions in the registry instead of reporting every job missing. An
 * empty answer is treated the same way: it is what an account other than the
 * owner's gets, and what a database without pg_cron returns.
 */

type ScheduleRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  last_started_at: string | null;
  last_status: string | null;
  last_message: string | null;
};

type RunRow = { created_at: string; status: string; error: string | null };

async function loadSchedules(supabase: SupabaseClient): Promise<ScheduleFact[] | null> {
  const { data, error } = await supabase.rpc('routine_schedules');
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return (data as ScheduleRow[]).map((row) => ({
    jobname: row.jobname,
    schedule: row.schedule,
    active: row.active,
    lastStartedAt: row.last_started_at,
    lastStatus: row.last_status,
    lastMessage: row.last_message,
  }));
}

async function latestRun(
  client: SupabaseClient | GoalsSupabaseClient,
  table: 'plan_runs' | 'runs',
  job: string,
): Promise<RunFact | null> {
  const { data, error } = await (client as SupabaseClient)
    .from(table)
    .select('created_at, status, error')
    .eq('job', job)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as RunRow;
  return { createdAt: row.created_at, status: row.status, error: row.error };
}

export async function loadRoutineFacts(
  routines: readonly Routine[],
  clients: { supabase: SupabaseClient; goals?: GoalsSupabaseClient },
): Promise<RoutineFacts> {
  const withRuns = routines.filter((routine) => routine.runs);
  const [schedules, latest] = await Promise.all([
    loadSchedules(clients.supabase),
    Promise.all(
      withRuns.map(async ({ runs }) => {
        const { table, job } = runs!;
        const client = table === 'goals_runs' ? clients.goals : clients.supabase;
        if (!client) return null;
        const run = await latestRun(client, table === 'goals_runs' ? 'runs' : 'plan_runs', job);
        return run ? ([runKey(table, job), run] as const) : null;
      }),
    ),
  ]);
  return {
    schedules,
    runs: new Map(latest.filter((entry) => entry !== null)),
  };
}

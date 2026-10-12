import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { readLastLines } from '@/lib/core/run-liveness';
import { quietRuns, silentRuns, type StartedRunRow } from '@/lib/goals/run-sweep';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * Close goal runs that stopped reporting (plan #1002), a stage of the daily
 * cron and of the overnight tick, which pg_cron calls every four minutes. A
 * run quiet for 45 minutes is therefore closed within the hour.
 *
 * Every account's runs: a dead run blocks nobody but its owner, and closing
 * it is never wrong. Each close is guarded on the row still being started
 * with the same last report, so a session that reports or finishes between
 * the read and the write keeps its run.
 */

export type GoalsQuietSweepResult = { closed: string[]; stale: string[] };

/** Far past the number of runs that can be going at once. */
const STARTED_LIMIT = 500;

export async function runGoalsQuietSweep(deps?: {
  client?: GoalsSupabaseClient;
  now?: number;
}): Promise<GoalsQuietSweepResult> {
  const client = deps?.client ?? createGoalsServiceSupabase();
  const now = deps?.now ?? Date.now();

  const { data, error } = await client
    .from('runs')
    .select('id, user_id, created_at, last_seen_at, now_on')
    .eq('status', 'started')
    .limit(STARTED_LIMIT);
  if (error) throw new Error(`Could not read started goal runs: ${error.message}`);

  const rows = (data ?? []) as StartedRunRow[];
  // A run that writes lines is judged by its newest one and marked stale when
  // silent, never closed here (plan #1825). A failed read leaves every run to
  // the 45-minute rule, as before there were lines.
  const lines = await readLastLines(
    client.schema('core') as never,
    'goals.runs',
    rows.map((row) => row.id),
  );

  const stale: string[] = [];
  for (const row of silentRuns(rows, lines, now)) {
    const update = client
      .from('runs')
      .update({ status: 'stale' })
      .eq('id', row.id)
      .eq('user_id', row.user_id)
      .eq('status', 'started');
    const written = await (row.last_seen_at === null
      ? update.is('last_seen_at', null)
      : update.eq('last_seen_at', row.last_seen_at)
    ).select('id');
    if (written.error) throw new Error(`Could not mark goal run ${row.id} stale: ${written.error.message}`);
    if ((written.data ?? []).length > 0) stale.push(row.id);
  }

  const closed: string[] = [];
  for (const close of quietRuns(rows, now, lines)) {
    const update = client
      .from('runs')
      .update({ status: 'failed', error: close.error, ended_at: new Date(now).toISOString() })
      .eq('id', close.id)
      .eq('user_id', close.userId)
      .eq('status', 'started');
    const written = await (close.lastSeenAt === null
      ? update.is('last_seen_at', null)
      : update.eq('last_seen_at', close.lastSeenAt)
    ).select('id');
    if (written.error) throw new Error(`Could not close goal run ${close.id}: ${written.error.message}`);
    if ((written.data ?? []).length > 0) closed.push(close.id);
  }
  return { closed, stale };
}

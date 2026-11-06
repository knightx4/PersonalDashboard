import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { PROGRESS_STATES, type ProgressState } from '@/lib/plan/session-progress';
import type { BuildRun } from '@/lib/you/live-cards';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plan's tables are read with the untyped client
type Db = SupabaseClient<any, 'public'>;

/** A thread holds a handful of builds; more than this is read in the next refresh, not all at once. */
const RUNS_MAX = 50;

/**
 * Where each build a People thread started stands (plan #2854.3), by run id:
 * the run's status and why it stopped, the step's status, and the newest
 * report its session made in core.session_progress. RLS keeps every read to
 * the signed-in person's rows. A run that cannot be read is left out, and
 * the card says the build is starting until it can be.
 */
export async function loadBuildRuns(
  db: Db,
  core: CoreSupabaseClient,
  runIds: readonly string[],
): Promise<Record<string, BuildRun>> {
  const ids = [...new Set(runIds)].slice(0, RUNS_MAX);
  if (ids.length === 0) return {};

  const [runs, reports] = await Promise.all([
    db.from('plan_runs').select('id, status, plan_item_id, stop_reason, error').in('id', ids),
    core
      .from('session_progress')
      .select('plan_run_id, state, action, needs, updated_at')
      .in('plan_run_id', ids)
      .order('updated_at', { ascending: false }),
  ]);
  if (runs.error) throw new Error(`Reading the builds failed: ${runs.error.message}`);
  // A build still reads from its run when the reports cannot be read.
  if (reports.error) console.error(`core.session_progress could not be read: ${reports.error.message}`);

  const rows = (runs.data ?? []) as {
    id: string;
    status: string;
    plan_item_id: string | null;
    stop_reason: string | null;
    error: string | null;
  }[];
  const stepIds = [...new Set(rows.flatMap((row) => (row.plan_item_id ? [row.plan_item_id] : [])))];
  const steps = new Map<string, string>();
  if (stepIds.length > 0) {
    const { data, error } = await db.from('plan_items').select('id, status').in('id', stepIds);
    if (error) throw new Error(`Reading the built steps failed: ${error.message}`);
    for (const step of (data ?? []) as { id: string; status: string }[]) steps.set(step.id, step.status);
  }

  // Newest first, so the first report seen for a run is its latest.
  const latest = new Map<string, BuildRun['progress']>();
  for (const report of (reports.data ?? []) as { plan_run_id: string; state: string; action: string; needs: string | null }[]) {
    if (latest.has(report.plan_run_id)) continue;
    if (!(PROGRESS_STATES as readonly string[]).includes(report.state)) continue;
    latest.set(report.plan_run_id, { state: report.state as ProgressState, action: report.action, needs: report.needs });
  }

  const out: Record<string, BuildRun> = {};
  for (const row of rows) {
    out[row.id] = {
      runId: row.id,
      status: row.status,
      stepStatus: row.plan_item_id ? (steps.get(row.plan_item_id) ?? null) : null,
      stopReason: row.stop_reason,
      error: row.error,
      progress: latest.get(row.id) ?? null,
    };
  }
  return out;
}

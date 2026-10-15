/**
 * Where a Dash run is read, and which of several going runs the status line
 * follows (plan #1964.2.3).
 */
import type { RunTable } from '@/lib/core/run-activities';

/** The page of one run: a goal run's, or a plan run's under the plan. */
export function runHref(table: RunTable, id: string): string {
  return table === 'goals.runs' ? `/goals/runs/${id}` : `/dev/plan/runs/${id}`;
}

/** A run that is going, as the status line holds it. */
export type GoingRun = { table: RunTable; id: string; created_at: string };

/**
 * A run still marked started after this long has almost certainly died
 * without the sweep that marks it stale reaching it, so the status line does
 * not claim Dash is on it.
 */
export const GOING_RUN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The newest of the runs, or null when there are none. */
export function newestGoingRun(runs: readonly (GoingRun | null | undefined)[]): GoingRun | null {
  let best: GoingRun | null = null;
  for (const run of runs) {
    if (!run) continue;
    if (!best || Date.parse(run.created_at) > Date.parse(best.created_at)) best = run;
  }
  return best;
}

/** The earliest created_at a going run may have to be shown, as an ISO string. */
export function goingRunCutoff(now: number): string {
  return new Date(now - GOING_RUN_MAX_AGE_MS).toISOString();
}

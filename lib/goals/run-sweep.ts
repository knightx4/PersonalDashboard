/**
 * Which started goal runs have gone quiet (plan #1002).
 *
 * A session that dies never writes its run row back. The goals skill reports
 * at each step it starts (last_seen_at and now_on on goals.runs), so a run
 * with nothing heard for RUN_QUIET_MS has stopped. The sweep in
 * inngest/goals/quiet-runs.ts, run by the daily and overnight ticks, closes
 * each one as failed with the error below, which frees Ask Dash
 * on the steps it was on.
 *
 * Pure: the sweep reads the started rows and writes the closes.
 */
import { lineSilent } from '@/lib/core/run-liveness';
import { quietRunError, runIsQuiet } from '@/lib/goals/shaping';

/** A started goals.runs row, as the sweep reads it. */
export type StartedRunRow = {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string | null;
  now_on: string | null;
};

export type QuietRunClose = {
  id: string;
  userId: string;
  /** The report the close was judged on, so a newer one keeps the run open. */
  lastSeenAt: string | null;
  error: string;
};

/**
 * The started runs to close, each with the error it is closed with. A run
 * that has written a line (in `lines`, by run id) is never closed here: its
 * lines decide, in `silentRuns` below (plan #1825).
 */
export function quietRuns(
  rows: readonly StartedRunRow[],
  now: number,
  lines: ReadonlyMap<string, string> = new Map(),
): QuietRunClose[] {
  return rows
    .filter((row) => !lines.has(row.id))
    .filter((row) => runIsQuiet({ createdAt: row.created_at, lastSeenAt: row.last_seen_at }, now))
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      lastSeenAt: row.last_seen_at,
      error: quietRunError({ nowOn: row.now_on }),
    }));
}

/**
 * The started runs that write lines and have gone silent: nothing heard for
 * RUN_SILENT_MINUTES since the later of their newest line and their last
 * report (plan #1825). The sweep marks these stale rather than closing them;
 * the person acknowledges a stale run to end it.
 */
export function silentRuns(
  rows: readonly StartedRunRow[],
  lines: ReadonlyMap<string, string>,
  now: number,
): StartedRunRow[] {
  return rows.filter((row) => {
    const line = lines.get(row.id);
    if (!line) return false;
    const heard =
      row.last_seen_at && Date.parse(row.last_seen_at) > Date.parse(line) ? row.last_seen_at : line;
    return lineSilent(heard, now) === true;
  });
}

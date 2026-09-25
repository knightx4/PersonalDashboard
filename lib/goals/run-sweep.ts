/**
 * Which started goal runs have gone quiet (plan #1002).
 *
 * A session that dies never writes its run row back. The goals skill reports
 * at each step it starts (last_seen_at and now_on on goals.runs), so a run
 * with nothing heard for RUN_QUIET_MS has stopped. The sweep in
 * inngest/goals/quiet-runs.ts, run by the daily and overnight ticks, closes
 * each one as failed with the error below, which frees Work on this and Send
 * on the steps it was on.
 *
 * Pure: the sweep reads the started rows and writes the closes.
 */
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

/** The started runs to close, each with the error it is closed with. */
export function quietRuns(rows: readonly StartedRunRow[], now: number): QuietRunClose[] {
  return rows
    .filter((row) => runIsQuiet({ createdAt: row.created_at, lastSeenAt: row.last_seen_at }, now))
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      lastSeenAt: row.last_seen_at,
      error: quietRunError({ nowOn: row.now_on }),
    }));
}

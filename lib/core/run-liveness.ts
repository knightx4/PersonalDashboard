/**
 * Whether a run is alive, read from its last line (plan #1825).
 *
 * A run that writes lines to core.run_activities (plan #1822) says when it was
 * last heard from, so the clock guesses (the two hours a plan run or a claim
 * was given, the 45 minutes a goal run was given) are not needed for it. A run
 * silent for RUN_SILENT_MINUTES after its newest line is marked `stale`, and
 * stays so until the person acknowledges it, which ends it as failed. Nothing
 * closes it quietly.
 *
 * A run that has written no lines is judged by the clock rules it had before,
 * so skills that do not write lines yet keep working. The functions here
 * return null for such a run to say "no lines, use the old rule".
 */
import type { RunTable } from './run-activities';

/** How long a run that writes lines may go without one before it is stale. */
export const RUN_SILENT_MINUTES = 30;

/**
 * Whether a run that writes lines has gone silent: true once its newest line
 * is RUN_SILENT_MINUTES old, false while it is newer, and null when the run
 * has written no line (the caller falls back to its clock rule). `now` of 0
 * is the clock's pre-mount value, at which nothing has gone silent.
 */
export function lineSilent(lastLineAt: string | null | undefined, now: number): boolean | null {
  if (!lastLineAt) return null;
  const at = Date.parse(lastLineAt);
  if (!Number.isFinite(at)) return null;
  if (now === 0) return false;
  return (now - at) / 60_000 >= RUN_SILENT_MINUTES;
}

/** The minimum a client needs for the read below: `.rpc` on the core schema. */
type CoreRpc = {
  rpc: (
    fn: 'run_last_lines',
    args: { p_run_table: RunTable; p_run_ids: string[] },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * The newest line time of each run named that has written one, by run id.
 * A run missing from the map wrote none. A failed read is logged and returns
 * an empty map, which leaves every run to its clock rule as before.
 */
export async function readLastLines(
  core: CoreRpc,
  runTable: RunTable,
  runIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(runIds)];
  if (ids.length === 0) return out;
  const { data, error } = await core.rpc('run_last_lines', { p_run_table: runTable, p_run_ids: ids });
  if (error) {
    console.error(`the runs' last lines could not be read: ${error.message}`);
    return out;
  }
  for (const row of (data ?? []) as Array<{ run_id: string; last_at: string }>) {
    if (row.run_id && row.last_at) out.set(row.run_id, row.last_at);
  }
  return out;
}

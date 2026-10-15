/**
 * Whether a run a button started is still going (plan #1964.2.1), so the
 * button keeps Dash's mark working for as long as the run lasts rather than
 * for the second the press takes.
 *
 * Both runs tables keep the same four statuses beside their own ending
 * (supabase/migrations/0197_run_activities.sql): `started` while the session
 * works, `awaiting_input` when it has asked you something, `stale` when it
 * stopped writing lines, and `finished`, `done` or `failed` once it ended.
 * Only `started` counts as going: a run waiting on your answer is not working,
 * and a stale one may be dead, so neither keeps the mark busy.
 */
import type { RunTable } from '@/lib/core/run-activities';

/** The run a press started, as the button is given it. */
export type RunRef = {
  table: RunTable;
  id: string;
  /**
   * Whether the run was going when the page read it. Left out, a run just
   * handed over is taken as going until its row says otherwise.
   */
  going?: boolean;
};

/** Whether a runs row with this status is still being worked. */
export function runStatusGoing(status: unknown): boolean {
  return status === 'started';
}

/** The schema and table a run's row lives in, for a read or a Realtime filter. */
export function runTableParts(table: RunTable): { schema: string; table: string } {
  return table === 'goals.runs' ? { schema: 'goals', table: 'runs' } : { schema: 'public', table: 'plan_runs' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the run can be followed over the network: a real row id. A gallery
 * fixture names a run that is not in any database, and is drawn from its
 * `going` alone.
 */
export function runFollowable(run: RunRef | null | undefined): run is RunRef {
  return Boolean(run && UUID.test(run.id));
}

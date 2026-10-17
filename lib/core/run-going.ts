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

/** A goals run still going, as `runSubjectRefs` reads it. */
export type GoingGoalsRun = { item_id: string | null; area_id: string | null };

/** One goals item a going run is on, with the goal it sits under. */
export type GoingGoalsItem = { id: string; parent_id: string | null };

/** What the other workspaces hold that bears on a goal (goals.context). */
export type GoingContext = { item_id: string; source: string; ref: string; status: string };

/**
 * The rows the runs still going are about, as refs (plan #1964.2.2), for the
 * workspaces to say "Dash is on it" on them the way an open Ask Dash hand-off
 * does. A plan run is about its step. A goals run is about its step or goal,
 * the goal above a step, its area, and every row the goal's context points
 * at that you have not dismissed: the role a job goal is about, the note a
 * reading goal grew from. That last is how a run on /goals reaches a row in
 * Jobs, Learn, the vault or News.
 *
 * A context row for a vault note names it by path (goals.context.ref), so a
 * vault row checks its path as well as its id.
 */
export function runSubjectRefs(input: {
  planItemIds: readonly (string | null)[];
  goalsRuns: readonly GoingGoalsRun[];
  goalsItems: readonly GoingGoalsItem[];
  context: readonly GoingContext[];
}): string[] {
  const refs = new Set<string>();
  for (const id of input.planItemIds) if (id) refs.add(`public.plan_items:${id}`);
  for (const run of input.goalsRuns) {
    if (run.item_id) refs.add(`goals.items:${run.item_id}`);
    if (run.area_id) refs.add(`goals.areas:${run.area_id}`);
  }
  for (const item of input.goalsItems) {
    refs.add(`goals.items:${item.id}`);
    if (item.parent_id) refs.add(`goals.items:${item.parent_id}`);
  }
  const items = new Set([...refs].filter((r) => r.startsWith('goals.items:')).map((r) => r.slice('goals.items:'.length)));
  for (const row of input.context) {
    if (row.status === 'dismissed' || !items.has(row.item_id)) continue;
    const ref = row.ref.trim();
    if (ref) refs.add(`${row.source}:${ref}`);
  }
  return [...refs];
}

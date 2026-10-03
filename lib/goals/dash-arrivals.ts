/**
 * The steps Dash finished, for the goal page's arrival moment (plan #1561;
 * docs/UI-QUALITY-SPEC.md, Part 8, "A step Dash finished").
 *
 * A step counts when the latest write that closed it is Dash's: a goals.history
 * row on the step whose new status is done, written as `claude` by a run. A
 * step Dash closed and you then reopened and closed yourself is yours, so only
 * the latest close decides. Closes older than ARRIVAL_DAYS are left out, so a
 * new browser does not play the moment on every step Dash has ever finished.
 *
 * Which of these you have already seen is kept in the browser
 * (app/goals/[goalId]/dash-arrival.ts); this list only says which could still
 * be new.
 *
 * Pure. The read is in lib/goals/dash-arrivals-store.ts.
 */

/** How far back a close Dash made can still arrive. */
export const ARRIVAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A goals.history row that closed a step. */
export type CloseRow = { id: number; row_id: string; actor: string; created_at: string };

/** The ids of the steps whose latest close was Dash's and recent enough to arrive. */
export function dashArrivals(rows: readonly CloseRow[], now: number, days = ARRIVAL_DAYS): string[] {
  const latest = new Map<string, CloseRow>();
  for (const row of rows) {
    const seen = latest.get(row.row_id);
    if (!seen || row.id > seen.id) latest.set(row.row_id, row);
  }
  const since = now - days * DAY_MS;
  return [...latest.values()]
    .filter((row) => row.actor === 'claude' && Date.parse(row.created_at) >= since)
    .map((row) => row.row_id);
}

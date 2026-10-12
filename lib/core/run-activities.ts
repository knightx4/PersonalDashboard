/**
 * The lines a Dash run writes as it works (plan #1822), kept in
 * core.run_activities for both plan runs and goal runs. The database checks
 * hold the same lists (supabase/migrations/0197_run_activities.sql), and
 * tests/run-activities.test.ts fails when the two drift apart.
 */

/** Which runs table a line's run_id is in. */
export const RUN_TABLES = ['plan_runs', 'goals.runs'] as const;
export type RunTable = (typeof RUN_TABLES)[number];

/**
 * thought: what Dash is about to do. action: something it did (claimed,
 * committed, closed). question: something it needs answered, with options.
 * response: the person's answer. error: something that went wrong.
 */
export const RUN_ACTIVITY_KINDS = ['thought', 'action', 'question', 'response', 'error'] as const;
export type RunActivityKind = (typeof RUN_ACTIVITY_KINDS)[number];

/**
 * The two statuses both runs tables gained alongside their own ('started',
 * then 'finished' on plan_runs or 'done' on goals.runs, or 'failed').
 * awaiting_input: the run asked a question and is waiting on the answer.
 * stale: the run stopped writing lines.
 */
export const RUN_WAITING_STATUSES = ['awaiting_input', 'stale'] as const;
export type RunWaitingStatus = (typeof RUN_WAITING_STATUSES)[number];

export type RunActivity = {
  id: string;
  user_id: string;
  run_table: RunTable;
  run_id: string;
  kind: RunActivityKind;
  body: string;
  /** A question's choices; null on every other kind. */
  options: string[] | null;
  created_at: string;
};

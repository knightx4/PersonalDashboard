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

/** The columns a run's page reads. */
export const RUN_ACTIVITY_COLUMNS = 'id, user_id, run_table, run_id, kind, body, options, created_at';

/**
 * One row as the page reads it, from a select or a Realtime payload, or null
 * when it is not a line this app knows how to draw (plan #1826). The
 * database checks keep run_table and kind to the lists above, so a null here
 * means a payload that was not a run_activities row at all.
 */
export function runActivityFrom(row: Record<string, unknown> | null | undefined): RunActivity | null {
  if (!row) return null;
  const { id, user_id, run_table, run_id, kind, body, options, created_at } = row;
  if (typeof id !== 'string' || typeof run_id !== 'string' || typeof body !== 'string') return null;
  if (typeof created_at !== 'string' || typeof user_id !== 'string') return null;
  if (!RUN_TABLES.includes(run_table as RunTable)) return null;
  if (!RUN_ACTIVITY_KINDS.includes(kind as RunActivityKind)) return null;
  const choices = Array.isArray(options)
    ? options.filter((option): option is string => typeof option === 'string')
    : null;
  return {
    id,
    user_id,
    run_table: run_table as RunTable,
    run_id,
    kind: kind as RunActivityKind,
    body,
    options: choices && choices.length > 0 ? choices : null,
    created_at,
  };
}

/**
 * The lines a page holds with new ones added: each line once, oldest first.
 *
 * A page subscribes before it reads, so the first lines can arrive twice
 * (once in the read, once from Realtime) and out of order; the id settles
 * the first and created_at the second.
 */
export function mergeRunLines(
  held: readonly RunActivity[],
  incoming: readonly RunActivity[],
): RunActivity[] {
  const byId = new Map<string, RunActivity>();
  for (const line of held) byId.set(line.id, line);
  for (const line of incoming) byId.set(line.id, line);
  return [...byId.values()].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
  );
}

/** What each kind of line is called beside it on a run's page. */
export const RUN_ACTIVITY_LABEL: Record<RunActivityKind, string> = {
  thought: 'Thinking',
  action: 'Did',
  question: 'Asked you',
  response: 'You said',
  error: 'Went wrong',
};

/** What a run that went quiet and was acknowledged is closed with. */
export const ACKNOWLEDGED_STALE_ERROR = 'It stopped writing lines, and you acknowledged it.';

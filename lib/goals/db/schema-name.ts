/**
 * The Postgres schema that holds the goals module (docs/GOALS-SPEC.md).
 *
 * Its own schema, as the other modules have theirs, and for the reason the
 * spec gives: personal goals kept in the dev plan's tables would sit on /dev
 * surfaces that other accounts cannot see.
 *
 * Three things have to agree, as for every other schema:
 *
 *   1. The migrations in supabase/migrations-goals create everything here.
 *   2. Every supabase-js client that touches it passes
 *      `db: { schema: GOALS_SCHEMA }`.
 *   3. The schema is exposed to PostgREST, which migrations-goals/0001 does.
 */
export const GOALS_SCHEMA = 'goals';

/**
 * A Supabase client bound to the goals schema, so a function typed against it
 * cannot be handed a client that reads another workspace's tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GoalsSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof GOALS_SCHEMA>;

/**
 * Who a change is recorded as in goals.history.
 *
 * The history trigger reads it from the `x-goals-actor` request header, and
 * without one it records a signed-in request as `me` and anything else as
 * `claude`. Only capture needs to say so: the capture box writes on your
 * session, and its changes are recorded as `capture` so they can be told
 * apart from ones you made by hand.
 */
export type GoalsActor = 'me' | 'claude' | 'capture';

/**
 * The request headers the history trigger reads. `undoes` names the history
 * row a write takes back, and `undoesField` the one collection field it takes
 * back, for Undo on a run's page (plan #1013).
 */
export function historyHeaders(options: {
  actor?: GoalsActor;
  captureId?: string;
  runId?: string;
  undoes?: number;
  undoesField?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.actor) headers['x-goals-actor'] = options.actor;
  if (options.captureId) headers['x-goals-capture'] = options.captureId;
  if (options.runId) headers['x-goals-run'] = options.runId;
  if (options.undoes !== undefined) headers['x-goals-undo'] = String(options.undoes);
  if (options.undoesField) headers['x-goals-undo-field'] = options.undoesField;
  return headers;
}

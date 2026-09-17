/**
 * Starting a routine and writing down that it was started.
 *
 * Every dev button that fires a routine went through `fireFeatureRoutine` and
 * kept nothing: the response was read for its status code, turned into a line
 * for the toast and dropped. So the app could never answer "is anything working
 * on this step" with evidence -- only with the step's own `status` column and a
 * clock, which is why `lib/plan/claims.ts` has to take a claim back on a
 * two-hour guess.
 *
 * This is the one way in now. It fires, then writes a `plan_runs` row naming
 * the step where there is one, the press it came from, the routine it went to
 * and the whole response body. A press that failed is a row as well, with the
 * reason, because a run that never started and a press nobody made are
 * different facts and looked identical before.
 *
 * The write cannot fail the press. By the time it runs the routine is already
 * going, and refusing to say so would leave the person believing nothing had
 * started when something had -- a worse lie than a missing record. A failed
 * insert says so on the server log and the press reports what happened to the
 * fire.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fireFeatureRoutine,
  resolveRoutineId,
  type FireRoutineResult,
  type RoutineTarget,
} from '@/lib/feedback/routine';
import { runEnd, runQuietNote, type LastRun, type RunStatus } from './run-end';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * Which press started the run.
 *
 * The button, not the routine: two of these fire the same plan routine with
 * different briefs, and what somebody reading the record wants to know is what
 * was asked for. `raise` is the one that is not a button -- writing an answer
 * on a raise is the press -- and it is its own job rather than a `comment` for
 * the same reason: the brief is the raise and the answer, not a question asked
 * on a row.
 */
export type RunJob =
  | 'step'
  | 'feature'
  | 'queue'
  | 'reshape'
  | 'shape'
  | 'notes'
  | 'review'
  | 'comment'
  | 'raise';

/** A `plan_runs` row, ready to insert. */
export type RunRow = {
  user_id: string;
  plan_item_id: string | null;
  job: RunJob;
  routine_id: string;
  external_id: string | null;
  status: RunStatus;
  http_status: number | null;
  response: unknown;
  error: string | null;
};

/** How much of a refusal is worth keeping. The column takes 4000. */
const ERROR_LIMIT = 4000;

/**
 * What a press should be recorded as, from what the fire came back with.
 *
 * Pure, so the rule about which presses count as started and what each row
 * carries is testable without a database or a network.
 */
export function runRowFor(input: {
  userId: string;
  job: RunJob;
  routineId: string | null;
  planItemId?: string | null;
  result: FireRoutineResult;
}): RunRow {
  const { result } = input;
  return {
    user_id: input.userId,
    plan_item_id: input.planItemId ?? null,
    job: input.job,
    routine_id: resolveRoutineId(input.routineId),
    external_id: result.ok ? result.runId : null,
    status: result.ok ? 'started' : 'failed',
    http_status: result.status,
    response: result.body ?? null,
    error: result.ok ? null : result.error.slice(0, ERROR_LIMIT),
  };
}

/**
 * Fire a routine and record the run, in that order.
 *
 * The result is the fire's, unchanged, so a caller reads it exactly as it read
 * `fireFeatureRoutine` before.
 */
export async function startRoutineRun(input: {
  supabase: Db;
  userId: string;
  job: RunJob;
  routine: RoutineTarget;
  /** The step this run is about, when it is about one. */
  planItemId?: string | null;
  /** The brief, appended to the routine's session. */
  text?: string | null;
  fetch?: typeof globalThis.fetch;
}): Promise<FireRoutineResult> {
  const result = await fireFeatureRoutine({
    apiKey: input.routine.token,
    routineId: input.routine.id,
    text: input.text,
    fetch: input.fetch,
  });

  const row = runRowFor({
    userId: input.userId,
    job: input.job,
    routineId: input.routine.id,
    planItemId: input.planItemId,
    result,
  });

  const { error } = await input.supabase.from('plan_runs').insert(row);
  if (error) {
    console.error(`plan_runs insert failed for a ${input.job} run: ${error.message}`);
  }

  return result;
}

/**
 * Write back every run that has stopped, and say how many.
 *
 * A run ends without telling anybody: the session closes its step and goes
 * away, or it dies and nothing at all happens. So the rows are read against
 * the steps they were sent at and against the clock -- `lib/plan/run-end.ts`
 * holds both rules -- and the ones that are over are written back here.
 *
 * Run from the plan page, which is where the answer is read. A failed sweep is
 * logged and swallowed for the same reason the insert above is: a page that
 * cannot tidy the record is still a page worth reading.
 */
export async function endQuietRuns(input: {
  supabase: Db;
  userId: string;
  now?: number;
}): Promise<{ finished: number; failed: number; error: string | null }> {
  const now = input.now ?? Date.now();
  const nothing = { finished: 0, failed: 0 };

  const { data: rows, error } = await input.supabase
    .from('plan_runs')
    .select('id, plan_item_id, created_at')
    .eq('user_id', input.userId)
    .eq('status', 'started');
  if (error) {
    console.error(`plan_runs could not be read to end quiet runs: ${error.message}`);
    return { ...nothing, error: error.message };
  }

  const started = (rows ?? []) as Array<{
    id: string;
    plan_item_id: string | null;
    created_at: string;
  }>;
  if (started.length === 0) return { ...nothing, error: null };

  // Only the steps these runs name, and only the column that says one closed.
  const stepIds = [...new Set(started.map((row) => row.plan_item_id).filter(Boolean))] as string[];
  const closedAt = new Map<string, string | null>();
  if (stepIds.length > 0) {
    const { data: steps } = await input.supabase
      .from('plan_items')
      .select('id, completed_at')
      .in('id', stepIds);
    for (const step of (steps ?? []) as Array<{ id: string; completed_at: string | null }>) {
      closedAt.set(step.id, step.completed_at);
    }
  }

  const finished: string[] = [];
  const quiet: string[] = [];
  for (const row of started) {
    const step = row.plan_item_id ? { completedAt: closedAt.get(row.plan_item_id) ?? null } : null;
    const end = runEnd({ status: 'started', createdAt: row.created_at }, step, now);
    if (end === 'finished') finished.push(row.id);
    if (end === 'failed') quiet.push(row.id);
  }

  if (finished.length > 0) {
    await input.supabase.from('plan_runs').update({ status: 'finished' }).in('id', finished);
  }
  // One at a time, because each reason names how long that run was silent.
  for (const row of started.filter((candidate) => quiet.includes(candidate.id))) {
    await input.supabase
      .from('plan_runs')
      .update({ status: 'failed', error: runQuietNote(row.created_at, now) })
      .eq('id', row.id);
  }

  return { finished: finished.length, failed: quiet.length, error: null };
}

/**
 * The last run against each step, by step id.
 *
 * One read of the account's runs rather than one per row: there are tens of
 * them, and the plan page wants the newest against every step it draws.
 */
export async function loadLastRuns(
  supabase: Db,
  userId: string,
): Promise<Record<string, LastRun>> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('plan_item_id, status, error, created_at')
    .eq('user_id', userId)
    .not('plan_item_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`plan_runs could not be read for the plan page: ${error.message}`);
    return {};
  }

  const last: Record<string, LastRun> = {};
  for (const row of (data ?? []) as Array<{
    plan_item_id: string;
    status: string;
    error: string | null;
    created_at: string;
  }>) {
    if (last[row.plan_item_id]) continue;
    last[row.plan_item_id] = {
      status: row.status === 'finished' || row.status === 'failed' ? row.status : 'started',
      createdAt: row.created_at,
      error: row.error,
    };
  }
  return last;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * Which press started the run.
 *
 * The button, not the routine: two of these fire the same plan routine with
 * different briefs, and what somebody reading the record wants to know is what
 * was asked for.
 */
export type RunJob =
  | 'step'
  | 'feature'
  | 'queue'
  | 'reshape'
  | 'shape'
  | 'notes'
  | 'review'
  | 'comment';

/** A `plan_runs` row, ready to insert. */
export type RunRow = {
  user_id: string;
  plan_item_id: string | null;
  job: RunJob;
  routine_id: string;
  external_id: string | null;
  status: 'started' | 'failed';
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

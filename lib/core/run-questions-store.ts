import 'server-only';
import { RUN_ACTIVITY_COLUMNS, runActivityFrom, type RunActivity, type RunTable } from './run-activities';

/**
 * The reads and writes behind answering a run's question (plan #1824). Every
 * call goes through the client it is handed, on the person's own session, so
 * run_activities' policies keep each line to its run's owner.
 */

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** The part of a Supabase client these calls use: any client that can reach the core schema. */
type CoreClient = {
  schema: (name: 'core') => {
    from: (table: 'run_activities') => {
      select: (columns: string) => {
        in: (column: 'run_id', values: string[]) => {
          eq: (column: 'kind', value: 'question') => {
            order: (column: 'created_at', options: { ascending: boolean }) => Result;
          };
        };
      };
      insert: (row: Record<string, unknown>) => Result;
    };
  };
};

/**
 * The newest question line of each run, by run id. A run waiting on you has
 * asked one; a run missing from the map wrote its status by hand without the
 * line, and the inbox says so rather than leaving it out.
 */
export async function latestQuestions(
  client: unknown,
  runIds: readonly string[],
): Promise<Record<string, RunActivity>> {
  if (runIds.length === 0) return {};
  const { data, error } = await (client as CoreClient)
    .schema('core')
    .from('run_activities')
    .select(RUN_ACTIVITY_COLUMNS)
    .in('run_id', [...runIds])
    .eq('kind', 'question')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`Could not read the runs' questions: ${error.message}`);
    return {};
  }
  const latest: Record<string, RunActivity> = {};
  for (const row of (data as unknown[] | null) ?? []) {
    const line = runActivityFrom(row as Record<string, unknown>);
    if (line && !latest[line.run_id]) latest[line.run_id] = line;
  }
  return latest;
}

/** Your answer, written as a response line on the run. RLS lets only the run's owner. */
export async function writeResponse(
  client: unknown,
  input: { userId: string; runTable: RunTable; runId: string; answer: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await (client as CoreClient).schema('core').from('run_activities').insert({
    user_id: input.userId,
    run_table: input.runTable,
    run_id: input.runId,
    kind: 'response',
    body: input.answer,
  });
  if (error) {
    console.error(`Could not write the answer to run ${input.runId}: ${error.message}`);
    return { ok: false, error: 'Your answer could not be saved. Try again.' };
  }
  return { ok: true };
}

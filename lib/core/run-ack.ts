import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { acknowledgedNote, readLastLines } from './run-liveness';
import type { RunTable } from './run-activities';

/**
 * Acknowledge a stale run, which ends it (plan #1825).
 *
 * A run that stopped writing lines is marked stale by the sweeps and stays so
 * until the person says they have seen it. Ending it is `failed` with a note
 * naming when its last line was written, because nothing says the work was
 * done. Only a run still stale is written: one that wrote a line since the
 * page was drawn is going again and is left alone.
 *
 * `client` is the signed-in person's own, so row level security keeps the
 * write to their runs. Returns whether a run was ended.
 */
export async function acknowledgeStaleRun(
  client: SupabaseClient<any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  runTable: RunTable,
  runId: string,
  now: number = Date.now(),
): Promise<{ ended: boolean; error: string | null }> {
  const lines = await readLastLines(client.schema('core') as never, runTable, [runId]);
  const error = acknowledgedNote(lines.get(runId) ?? null);

  const write =
    runTable === 'plan_runs'
      ? client.schema('public').from('plan_runs').update({ status: 'failed', error })
      : client
          .schema('goals')
          .from('runs')
          .update({ status: 'failed', error, ended_at: new Date(now).toISOString() });
  const { data, error: writeError } = await write
    .eq('id', runId)
    .eq('status', 'stale')
    .select('id');
  if (writeError) return { ended: false, error: writeError.message };
  return { ended: (data ?? []).length > 0, error: null };
}

import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { writeInsights, writeInsightsPorts, type WriteInsightsResult } from '@/lib/you/insights-write';

/**
 * Work one queued insights run: the single model call over the stored digest
 * (plan #2413.9), run from /api/cron/you-insights after its response so the
 * press that queued it and the daily cron never wait for it (plan #2413.10).
 *
 * The run row names its owner; everything after that is scoped to them. The
 * function that hosts the call lives five minutes (the route's maxDuration),
 * so the stream is given up a little before that and the run fails with a
 * sentence, rather than the function being stopped with the run still showing
 * as going.
 */

/** Shorter than the route's maxDuration of 300 seconds, so the failure is written. */
export const CALL_TIMEOUT_MS = 285_000;

export const NO_KEY_ERROR =
  'Dash cannot write insights yet: ANTHROPIC_API_KEY is not set on this deployment. Add it to the project’s environment variables, then press Look again.';

export type PumpInsightResult = WriteInsightsResult | { skipped: string };

export async function pumpInsightRun(
  input: { runId: string },
  deps?: { you?: YouSupabaseClient; anthropicApiKey?: string | null },
): Promise<PumpInsightResult> {
  const you = deps?.you ?? (createServiceSchemaSupabase('you') as unknown as YouSupabaseClient);
  const { data, error } = await you
    .from('insight_runs')
    .select('user_id, status')
    .eq('id', input.runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the insight run: ${error.message}`);
  const run = data as { user_id: string; status: string } | null;
  if (!run) return { skipped: 'no such run' };
  // Only a queued run is taken, so a repeated kick does not start the call twice.
  if (run.status !== 'queued') return { skipped: `the run is ${run.status}` };
  const userId = run.user_id;

  const apiKey = deps?.anthropicApiKey !== undefined ? deps.anthropicApiKey : process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    await you
      .from('insight_runs')
      .update({ status: 'failed', error: NO_KEY_ERROR, finished_at: new Date().toISOString() })
      .eq('id', input.runId)
      .eq('user_id', userId)
      .in('status', ['queued', 'running']);
    return { ok: false, runId: input.runId, error: NO_KEY_ERROR };
  }

  return writeInsights({
    ports: writeInsightsPorts({
      supabase: createVaultServiceSupabase(),
      core: createCoreServiceSupabase(),
      userId,
      anthropicApiKey: apiKey,
      timeoutMs: CALL_TIMEOUT_MS,
    }),
    runId: input.runId,
  });
}

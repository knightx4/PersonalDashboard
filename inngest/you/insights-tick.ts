import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { INSIGHT_RUN_STALE_AFTER_MS } from '@/lib/you/insights-run';
import { kickInsightRun } from '@/lib/you/insights-kick';
import { queueInsightRun } from '@/lib/you/insights-start';
import { decideInsightRun, type TickRun } from '@/lib/you/insights-triggers';

/**
 * The insights stage of the daily cron (plan #2413.10). Once a day it asks
 * lib/you/insights-triggers.ts whether the owner needs a run: only when the
 * last ready run is over thirty days old. It queues the run and starts the
 * single model call in a function of its own (/api/cron/you-insights), so the
 * stage costs a few requests however long the call takes. Nothing else
 * starts a run by itself.
 */

type RunRow = { status: TickRun['status']; requested_at: string; finished_at: string | null };
const asRun = (r: RunRow): TickRun => ({ status: r.status, requestedAt: r.requested_at, finishedAt: r.finished_at });

export type InsightsTickResult = { skipped: string } | { started: true; runId: string };

export async function runInsightsTick(
  origin: string,
  deps?: {
    you?: YouSupabaseClient;
    userId?: string;
    now?: number;
    kick?: (origin: string, runId: string) => Promise<boolean>;
  },
): Promise<InsightsTickResult> {
  const now = deps?.now ?? Date.now();

  let userId = deps?.userId;
  if (!userId) {
    const owner = await createServiceSupabase().rpc('app_owner');
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(owner.data);
    if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to run insights for.');
    userId = parsed.data.userId;
  }
  const you = deps?.you ?? (createServiceSchemaSupabase('you') as unknown as YouSupabaseClient);

  const latest = await you
    .from('insight_runs')
    .select('status, requested_at, finished_at')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1);
  if (latest.error) throw new Error(`Could not read insight runs: ${latest.error.message}`);
  const ready = await you
    .from('insight_runs')
    .select('status, requested_at, finished_at')
    .eq('user_id', userId)
    .eq('status', 'ready')
    .order('requested_at', { ascending: false })
    .limit(1);
  if (ready.error) throw new Error(`Could not read insight runs: ${ready.error.message}`);

  const decision = decideInsightRun({
    now,
    latest: latest.data?.[0] ? asRun(latest.data[0] as RunRow) : null,
    lastReady: ready.data?.[0] ? asRun(ready.data[0] as RunRow) : null,
    staleAfterMs: INSIGHT_RUN_STALE_AFTER_MS,
  });
  if (!decision.start) return { skipped: decision.skipped };

  const queued = await queueInsightRun({ client: you, userId, now });
  if (!queued.queued) {
    if (queued.reason === 'running') return { skipped: 'a run is already queued or running' };
    throw new Error(`The insights run did not start: ${queued.error}`);
  }
  const kicked = await (deps?.kick ?? kickInsightRun)(origin, queued.runId);
  if (!kicked) {
    await you
      .from('insight_runs')
      .update({
        status: 'failed',
        error: 'Dash could not start the run. Press Look again to try once more.',
        finished_at: new Date(now).toISOString(),
      })
      .eq('id', queued.runId)
      .eq('user_id', userId);
    throw new Error('The insights run was queued but its function could not be reached.');
  }
  return { started: true, runId: queued.runId };
}

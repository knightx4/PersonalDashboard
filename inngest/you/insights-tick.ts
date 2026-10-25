import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { INSIGHT_RUN_STALE_AFTER_MS } from '@/lib/you/insights-run';
import { startInsightRun } from '@/lib/you/insights-start';
import { decideInsightRun, type TickRun } from '@/lib/you/insights-triggers';

/**
 * The insights stage of the daily cron (plan #2413.10). Once a day it asks
 * lib/you/insights-triggers.ts whether the owner needs a run: only when the
 * last ready run is over thirty days old. It fires the goals routine with the
 * insights brief, so the monthly set is the full read the skill describes
 * (.claude/skills/insights/SKILL.md), the same as Look again. The stage costs
 * one request; the session runs on the person's plan. Nothing else starts a
 * run by itself.
 */

type RunRow = { status: TickRun['status']; requested_at: string; finished_at: string | null };
const asRun = (r: RunRow): TickRun => ({ status: r.status, requestedAt: r.requested_at, finishedAt: r.finished_at });

export type InsightsTickResult = { skipped: string } | { started: true; runId: string };

export async function runInsightsTick(deps?: {
  you?: YouSupabaseClient;
  userId?: string;
  now?: number;
  routine?: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<InsightsTickResult> {
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

  const started = await startInsightRun({
    client: you,
    userId,
    reason: 'monthly',
    routine: deps?.routine ?? goalsRoutine(),
    now,
    fetch: deps?.fetch,
  });
  if (started.started) return { started: true, runId: started.runId };
  if (started.reason === 'running') return { skipped: 'a run is already queued or running' };
  if (started.reason === 'no_routine') return { skipped: 'the goals routine is not set up on this deployment' };
  throw new Error(`The insights run did not start: ${started.error}`);
}

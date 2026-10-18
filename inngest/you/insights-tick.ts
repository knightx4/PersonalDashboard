import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { INSIGHT_RUN_STALE_AFTER_MS } from '@/lib/you/insights-run';
import { startInsightRun } from '@/lib/you/insights-start';
import { CHANGE_EVENT_KINDS, decideInsightRun, type ChangeEvent, type TickRun } from '@/lib/you/insights-triggers';

/**
 * The insights stage of the daily cron (plan #2413.6). Once a day it asks
 * lib/you/insights-triggers.ts whether the owner needs a run: weekly, when the
 * last ready run is over seven days old, or sooner when a rejection, an offer
 * or a finished goal has landed since the last run was asked for. It starts
 * the run through the same function as the Look again button. With the goals
 * routine unset it starts nothing.
 */

type RunRow = { status: TickRun['status']; requested_at: string; finished_at: string | null };
const asRun = (r: RunRow): TickRun => ({ status: r.status, requestedAt: r.requested_at, finishedAt: r.finished_at });

export type InsightsTickResult = { skipped: string } | { started: true; runId: string; reason: 'weekly' | 'change' };

export async function runInsightsTick(deps?: {
  you?: YouSupabaseClient;
  routine?: RoutineTarget;
  userId?: string;
  events?: (userId: string, since: string) => Promise<ChangeEvent[]>;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<InsightsTickResult> {
  const routine = deps?.routine ?? goalsRoutine();
  if (!routine.id || !routine.token) return { skipped: 'the goals routine is not set' };
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

  const latestRun = latest.data?.[0] ? asRun(latest.data[0] as RunRow) : null;
  const lastReady = ready.data?.[0] ? asRun(ready.data[0] as RunRow) : null;
  const since = latestRun?.requestedAt ?? new Date(0).toISOString();
  const events = await (deps?.events ?? loadChangeEvents)(userId, since);

  const decision = decideInsightRun({
    now,
    latest: latestRun,
    lastReady,
    events,
    staleAfterMs: INSIGHT_RUN_STALE_AFTER_MS,
  });
  if (!decision.start) return { skipped: decision.skipped };

  const result = await startInsightRun({
    client: you,
    userId,
    reason: decision.reason,
    change: decision.change,
    routine,
    now,
    fetch: deps?.fetch,
  });
  if (result.started) return { started: true, runId: result.runId, reason: decision.reason };
  if (result.reason === 'running') return { skipped: 'a run is already queued or running' };
  throw new Error(`The insights run did not start: ${result.error}`);
}

/**
 * Rejections and offers (job_search.application_events) and goals marked done
 * (goals.items, level goal; closed_at is kept by a trigger) since `since`,
 * newest first, for the owner only.
 */
async function loadChangeEvents(userId: string, since: string): Promise<ChangeEvent[]> {
  const jobs = createServiceSchemaSupabase('job_search');
  const goals = createServiceSchemaSupabase('goals');
  const [apps, done] = await Promise.all([
    jobs
      .from('application_events')
      .select('kind, occurred_at')
      .eq('user_id', userId)
      .in('kind', [...CHANGE_EVENT_KINDS])
      .gt('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(20),
    goals
      .from('items')
      .select('title, closed_at')
      .eq('user_id', userId)
      .eq('level', 'goal')
      .eq('status', 'done')
      .gt('closed_at', since)
      .order('closed_at', { ascending: false })
      .limit(20),
  ]);
  if (apps.error) throw new Error(`Could not read application events: ${apps.error.message}`);
  if (done.error) throw new Error(`Could not read goals: ${done.error.message}`);
  const events: ChangeEvent[] = [
    ...(apps.data ?? []).map((r: { kind: string; occurred_at: string }) => ({
      at: r.occurred_at,
      label: r.kind === 'offer' ? 'an offer on an application' : 'a rejection on an application',
    })),
    ...(done.data ?? []).map((r: { title: string; closed_at: string }) => ({
      at: r.closed_at,
      label: `the goal "${r.title.slice(0, 80)}" was marked done`,
    })),
  ];
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

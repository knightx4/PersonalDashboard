import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { QUESTION_RUN_STALE_AFTER_MS, startQuestionRun } from '@/lib/you/dash-questions-run';
import { decideQuestionRun, type QuestionTickRun } from '@/lib/you/dash-questions-triggers';

/**
 * The question stage of the daily cron (plan #2635.1). Once a day it asks
 * lib/you/dash-questions-triggers.ts whether the owner's Answer tab needs new
 * questions: at most once a week, only with fewer than three open, and only
 * after they answered or skipped one since the last run. It starts the run the
 * Ask button starts (lib/you/dash-questions-run.ts), with a brief that says
 * the weekly check started it. The stage costs a few reads; the session runs
 * on the person's plan.
 */

type RunRow = { status: QuestionTickRun['status']; requested_at: string; finished_at: string | null };
const asRun = (r: RunRow): QuestionTickRun => ({ status: r.status, requestedAt: r.requested_at, finishedAt: r.finished_at });

export type DashQuestionsTickResult = { skipped: string } | { started: true; runId: string };

export async function runDashQuestionsTick(deps?: {
  you?: YouSupabaseClient;
  userId?: string;
  now?: number;
  routine?: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<DashQuestionsTickResult> {
  const now = deps?.now ?? Date.now();

  let userId = deps?.userId;
  if (!userId) {
    const owner = await createServiceSupabase().rpc('app_owner');
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(owner.data);
    if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to ask questions of.');
    userId = parsed.data.userId;
  }
  const you = deps?.you ?? (createServiceSchemaSupabase('you') as unknown as YouSupabaseClient);

  const runs = (ready: boolean) => {
    let q = you.from('dash_question_runs').select('status, requested_at, finished_at').eq('user_id', userId);
    if (ready) q = q.eq('status', 'ready');
    return q.order('requested_at', { ascending: false }).limit(1);
  };
  const newest = (column: 'answered_at' | 'skipped_at') =>
    you
      .from('dash_questions')
      .select(column)
      .eq('user_id', userId)
      .not(column, 'is', null)
      .order(column, { ascending: false })
      .limit(1);

  const [latest, ready, open, answered, skipped] = await Promise.all([
    runs(false),
    runs(true),
    you.from('dash_questions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open'),
    newest('answered_at'),
    newest('skipped_at'),
  ]);
  for (const r of [latest, ready, open, answered, skipped]) {
    if (r.error) throw new Error(`Could not read Dash's questions: ${r.error.message}`);
  }

  const stamps = [
    (answered.data?.[0] as { answered_at?: string } | undefined)?.answered_at,
    (skipped.data?.[0] as { skipped_at?: string } | undefined)?.skipped_at,
  ].filter((s): s is string => typeof s === 'string');
  const lastResponseAt = stamps.length ? stamps.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;

  const decision = decideQuestionRun({
    now,
    latest: latest.data?.[0] ? asRun(latest.data[0] as RunRow) : null,
    lastReady: ready.data?.[0] ? asRun(ready.data[0] as RunRow) : null,
    openCount: open.count ?? 0,
    lastResponseAt,
    staleAfterMs: QUESTION_RUN_STALE_AFTER_MS,
  });
  if (!decision.start) return { skipped: decision.skipped };

  const started = await startQuestionRun({
    client: you,
    userId,
    routine: deps?.routine ?? goalsRoutine(),
    weekly: true,
    now,
    fetch: deps?.fetch,
  });
  if (started.started) return { started: true, runId: started.runId };
  if (started.reason === 'running') return { skipped: 'a question run is already queued or running' };
  if (started.reason === 'no_routine') return { skipped: 'the goals routine is not set up on this deployment' };
  throw new Error(`The question run did not start: ${started.error}`);
}

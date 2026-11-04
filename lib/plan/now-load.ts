import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanItem } from './load';
import type { LastRun } from './run-end';
import type { PlanLiveness } from './tree';
import type { StartedRun } from './runs';
import { refFor, type OutlineIndex } from './ref';
import { loadPlanRunQuestions } from './run-answer';
import { PROGRESS_STATES, type ProgressState } from './session-progress';
import { nowSessions, type GoingRun, type NowList, type NowStep, type ProgressRow } from './now';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plan's loaders take the untyped client
type Db = SupabaseClient<any, 'public'>;

/** How many reports are read; the section lists at most NOW_LIMIT of them. */
const PROGRESS_READ = 60;

/**
 * The Now section's rows for the plan page or a project's (plan #2800.3):
 * the account's latest session reports from core.session_progress, newest
 * first through the (user_id, updated_at desc) index, put beside the runs
 * the page has already read so a run that has not reported keeps its
 * push-based line. Never throws: the section is one part of a page that is
 * still worth reading without it.
 */
export async function loadNow(input: {
  supabase: Db;
  userId: string;
  items: readonly PlanItem[];
  outlines: OutlineIndex;
  lastRuns: Readonly<Record<string, LastRun>>;
  started: readonly StartedRun[];
  liveness: PlanLiveness;
  /** The project whose page this is, or null on Dev's plan. */
  scope: string | null;
  now: number;
}): Promise<NowList> {
  const { supabase, userId } = input;
  let progress: ProgressRow[] = [];
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('session_progress')
      .select('session_id, plan_item_id, plan_run_id, thread_id, project, state, action, needs, started_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(PROGRESS_READ);
    if (error) console.error(`core.session_progress could not be read: ${error.message}`);
    progress = ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
      const state = String(row.state) as ProgressState;
      if (!(PROGRESS_STATES as readonly string[]).includes(state)) return [];
      return [
        {
          sessionId: String(row.session_id),
          planItemId: (row.plan_item_id as string | null) ?? null,
          planRunId: (row.plan_run_id as string | null) ?? null,
          threadId: (row.thread_id as string | null) ?? null,
          project: (row.project as string | null) ?? null,
          state,
          action: String(row.action),
          needs: (row.needs as string | null) ?? null,
          startedAt: String(row.started_at),
          updatedAt: String(row.updated_at),
        },
      ];
    });
  } catch (error) {
    console.error('core.session_progress could not be read', error);
  }

  // Which of the runs the reports name have ended, so a session that ended
  // without reporting done is not listed as working.
  const reportedRunIds = [...new Set(progress.flatMap((row) => (row.planRunId ? [row.planRunId] : [])))];
  const endedRuns = new Set<string>();
  if (reportedRunIds.length > 0) {
    const { data } = await supabase
      .from('plan_runs')
      .select('id, status')
      .eq('user_id', userId)
      .in('id', reportedRunIds);
    for (const row of (data ?? []) as { id: string; status: string }[]) {
      if (!['started', 'awaiting_input', 'stale'].includes(row.status)) endedRuns.add(row.id);
    }
  }

  const questions = await loadPlanRunQuestions(supabase, userId);

  const steps = new Map<string, NowStep>();
  for (const item of input.items) {
    steps.set(item.id, {
      id: item.id,
      ref: refFor(item.number, input.outlines),
      title: item.title,
      href: `/dev/plan/${item.number}`,
      module: item.module,
    });
  }

  const going: GoingRun[] = input.started.map((run) => {
    const last = input.lastRuns[run.planItemId];
    const push = last?.reading?.lastPush ?? null;
    return {
      runId: last?.id ?? null,
      planItemId: run.planItemId,
      startedAt: run.at,
      status: run.status,
      liveness: input.liveness[run.planItemId] ?? null,
      lastPush: push ? { at: push.at, subject: push.subject } : null,
      lastLineAt: last?.lastLineAt ?? null,
    };
  });

  return nowSessions({
    progress,
    going,
    steps,
    questions: questions.map((question) => ({
      runId: question.runId,
      body: question.body,
      options: question.options,
    })),
    endedRuns,
    scope: input.scope,
    now: input.now,
  });
}

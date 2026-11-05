import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPlan } from '@/lib/plan/load';
import { outlineIndex, refFor } from '@/lib/plan/ref';
import { loadPlanRunQuestions } from '@/lib/plan/run-answer';
import { buildPlanTree } from '@/lib/plan/tree';
import { waitingOnYou } from '@/lib/plan/waiting';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { devBriefOf, REPORT_GONE_MS, type BriefProgress, type BriefRun, type DevBrief } from '@/lib/you/builder-model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plan's loaders take the untyped client
type Db = SupabaseClient<any, 'public'>;

/**
 * The rows behind the builder's "Dev now" (plan #2854.5): the whole plan,
 * read as the plan page reads it, for what waits on the person and what
 * shipped; the session reports of the last two hours and the runs going
 * now, for what is building; and the runs waiting on an answer.
 *
 * Every read names the person as well as relying on row level security.
 * Never throws: a reply is still worth sending without it, and the brief
 * then says the plan could not be read.
 */
export async function loadDevBrief(client: YouSupabaseClient, userId: string, now: Date): Promise<DevBrief | null> {
  const plan = client.schema('public') as unknown as Db;
  const core = client.schema('core') as unknown as Db;
  const since = new Date(now.getTime() - REPORT_GONE_MS).toISOString();
  try {
    const [data, progress, runs, runQuestions] = await Promise.all([
      loadPlan(plan, userId),
      core
        .from('session_progress')
        .select('plan_item_id, plan_run_id, state, action, needs, updated_at')
        .eq('user_id', userId)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(40),
      plan
        .from('plan_runs')
        .select('id, plan_item_id, status, created_at, last_push_subject')
        .eq('user_id', userId)
        .in('status', ['started', 'awaiting_input'])
        .order('created_at', { ascending: false })
        .limit(40),
      loadPlanRunQuestions(plan, userId),
    ]);
    if (progress.error) console.error(`The builder could not read session reports: ${progress.error.message}`);
    if (runs.error) console.error(`The builder could not read the runs going: ${runs.error.message}`);

    const sections = buildPlanTree(data);
    const outlines = outlineIndex(sections.flatMap((section) => section.nodes));
    const str = (value: unknown): string => (typeof value === 'string' ? value : '');
    return devBriefOf({
      items: data.items,
      refOf: (number) => refFor(number, outlines),
      waiting: waitingOnYou(sections),
      runQuestions: runQuestions.map((q) => ({ runId: q.runId, about: q.about, body: q.body })),
      progress: ((progress.data ?? []) as Record<string, unknown>[]).map(
        (row): BriefProgress => ({
          planItemId: str(row.plan_item_id) || null,
          planRunId: str(row.plan_run_id) || null,
          state: str(row.state),
          action: str(row.action),
          needs: str(row.needs) || null,
          updatedAt: str(row.updated_at),
        }),
      ),
      runs: ((runs.data ?? []) as Record<string, unknown>[]).flatMap((row): BriefRun[] =>
        str(row.id) && str(row.plan_item_id)
          ? [
              {
                id: str(row.id),
                planItemId: str(row.plan_item_id),
                status: str(row.status),
                createdAt: str(row.created_at),
                lastPushSubject: str(row.last_push_subject) || null,
              },
            ]
          : [],
      ),
      now: now.getTime(),
    });
  } catch (error) {
    console.error('The builder could not read the plan', error);
    return null;
  }
}

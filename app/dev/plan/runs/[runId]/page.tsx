import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadRunActivities } from '@/lib/core/run-activities-store';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';
import { whenAt } from '@/lib/core/when';
import { readAll } from '@/lib/learn/db/read-all';
import { ITEM_COLUMNS, planItemFromRow } from '@/lib/plan/load';
import { buildPlanTree, flattenSections } from '@/lib/plan/tree';
import { runTouched, type TouchStep } from '@/lib/plan/run-touched';
import type { RunJob } from '@/lib/plan/run-end';
import { LiveRunLines } from '@/components/runs/live-run-lines';
import { AcknowledgeRun } from '@/components/runs/acknowledge-run';
import { acknowledgePlanRunAction, answerPlanRunAction } from '../../run-actions';
import { PlanRunView, planRunState, planRunStatusLabel } from './plan-run-view';

export const metadata = { title: 'Run' };
export const dynamic = 'force-dynamic';

const RUN_COLUMNS =
  'id, plan_item_id, job, status, error, stop_reason, created_at, updated_at, stopped_at, last_push_at, last_push_sha, last_push_subject';

type RunRow = {
  id: string;
  plan_item_id: string | null;
  job: string;
  status: string;
  error: string | null;
  stop_reason: string | null;
  created_at: string;
  updated_at: string | null;
  stopped_at: string | null;
  last_push_at: string | null;
  last_push_sha: string | null;
  last_push_subject: string | null;
};

/** When an ended run ended: when it said it stopped, else its row's last write. */
function endedAt(run: RunRow): string | null {
  if (run.status !== 'finished' && run.status !== 'failed') return null;
  return run.stopped_at ?? run.updated_at ?? null;
}

/** Outside the component because it reads the clock. */
function factsOf(run: RunRow, timeZone: string) {
  const now = Date.now();
  const at = (iso: string) => whenAt(iso, { timeZone, now });
  const ended = endedAt(run);
  return {
    status: planRunStatusLabel(run.status),
    started: at(run.created_at),
    ended: ended ? at(ended) : 'Still going',
    push: run.last_push_at && run.last_push_sha ? { sha: run.last_push_sha, at: at(run.last_push_at) } : null,
  };
}

/**
 * One plan run's page (plan #1964.2.4): its lines, filling in while it goes,
 * and each row it touched as a link. The rows are read from what the run
 * left (lib/plan/run-touched.ts), against the whole plan so a step named by
 * its outline is found wherever it sits.
 */
export default async function PlanRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const user = await requireUser();
  const [account, supabase, core] = await Promise.all([
    loadAccountSettings(user.id),
    createClient(),
    createCoreClient(),
  ]);
  const { data } = await supabase
    .from('plan_runs')
    .select(RUN_COLUMNS)
    .eq('id', runId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data) notFound();
  const run = data as unknown as RunRow;

  const [activity, rows] = await Promise.all([
    loadRunActivities(core, runId),
    readAll<Record<string, unknown>>((from, to) =>
      supabase
        .from('plan_items')
        .select(ITEM_COLUMNS)
        .eq('user_id', user.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ).catch(() => [] as Record<string, unknown>[]),
  ]);
  const items = rows.map((row) => planItemFromRow(row));
  const nodes = flattenSections(buildPlanTree({ items, dependencies: [] }));
  const steps: TouchStep[] = nodes.map((node) => ({
    id: node.id,
    number: node.number,
    outline: node.outline,
    parentId: node.parentId,
    title: node.title,
    status: node.status,
    completedAt: node.completedAt,
  }));

  const touched = runTouched({
    run: {
      planItemId: run.plan_item_id,
      createdAt: run.created_at,
      endedAt: endedAt(run),
      lastPush: run.last_push_at ? { sha: run.last_push_sha, subject: run.last_push_subject } : null,
    },
    lines: activity,
    steps,
  });
  const sentAt = steps.find((step) => step.id === run.plan_item_id) ?? null;
  const state = planRunState(run.status);
  const failed = run.status === 'failed';
  const facts = factsOf(run, account.timezone);

  return (
    <PlanRunView
      subject={await rowSubject(toRef('public.plan_runs', runId))}
      job={run.job as RunJob}
      step={
        sentAt
          ? {
              href: touched.rows[0]?.href ?? `/dev/plan/${sentAt.number}`,
              label: `#${sentAt.outline ?? sentAt.number}`,
              title: sentAt.title,
            }
          : null
      }
      facts={facts}
      push={facts.push}
      problem={failed ? (run.stop_reason ?? run.error ?? 'No reason was recorded.') : run.stop_reason}
      going={state !== 'ended'}
      touched={touched}
      lines={
        <LiveRunLines
          runTable="plan_runs"
          runId={run.id}
          state={state}
          initial={activity}
          acknowledge={
            state === 'stale' ? <AcknowledgeRun runId={run.id} action={acknowledgePlanRunAction} /> : undefined
          }
          answer={answerPlanRunAction}
        />
      }
    />
  );
}

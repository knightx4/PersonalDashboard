import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { noLinks, weekInstants, type GoalLinks } from '@/lib/goals/links';
import { loadAimChoices, loadGoalLinks } from '@/lib/goals/links-store';
import { loadReadings } from '@/lib/goals/readings-store';
import { goalRunRows, type RunListing } from '@/lib/goals/runs';
import { loadGoalRuns } from '@/lib/goals/runs-store';
import {
  approvalLine,
  countOpenQuestions,
  countProposed,
  runInFlight,
  runProgress,
} from '@/lib/goals/shaping';
import type { StepNode } from '@/lib/goals/steps';
import type { GoalStatus } from '@/lib/goals/tree';
import { loadShaping } from '@/lib/goals/shaping-store';
import { loadGoalMap } from '@/lib/goals/steps-store';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { todayIn } from '@/lib/todo/tasks/model';
import { Card } from '@/components/ui/card';
import { GoalAddRow } from './goal-add-row';
import { GoalThread } from './goal-comments';
import { GoalHelp } from './goal-help';
import { GoalLinksSection } from './goal-links';
import { GoalNumber } from './goal-number';
import { GoalFog, GoalShaping } from './goal-shaping';
import { StepTree } from './step-tree';

export const metadata = { title: 'Goal' };
export const dynamic = 'force-dynamic';

/**
 * The full tree of one goal (docs/GOALS-SPEC.md, "The daily view"; plan
 * #925): every step and sub-step under it, and the steps from other goals
 * that also count towards it. One tap from the home, and meant for looking at
 * the whole map rather than for the daily visit.
 */
/**
 * What the Claude panel says. Outside the component because it reads the
 * clock, and reading the clock during render is unstable.
 */
function shapingLines(
  goalStatus: GoalStatus,
  steps: StepNode[],
  approvedAt: string | null,
  history: { runs: RunListing[]; more: boolean },
  timeZone: string,
) {
  const now = Date.now();
  const lastRun = history.runs[0] ?? null;
  const running = runInFlight(lastRun, now);
  return {
    approval: approvalLine({
      goalStatus,
      approvedAt,
      proposed: countProposed(steps),
      questions: countOpenQuestions(steps),
    }),
    runs: goalRunRows(history.runs, now, timeZone),
    moreRuns: history.more,
    running: running && lastRun ? runProgress(lastRun, now) : null,
  };
}

export default async function GoalMapPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(goalId)) notFound();

  const user = await requireUser();
  const account = await loadAccountSettings(user.id);
  const today = todayIn(account.timezone);
  const client = await createGoalsClient();
  const learnOn = moduleEnabled(account, 'learn');
  const jobsOn = moduleEnabled(account, 'jobs');
  const learn = learnOn ? await createLearnClient() : null;
  const jobs = jobsOn ? await createJobsClient() : null;
  const [map, readings, links, aims, shaping, history, owner] = await Promise.all([
    loadGoalMap(client, goalId, { userId: user.id, today }),
    loadReadings(client, goalId),
    // Read live from Learn and the job search (plan #931). A failed read is a
    // line where the links would be, not a broken goal page.
    loadGoalLinks(
      { goals: client, learn, jobs },
      goalId,
      weekInstants(today, account.timezone),
    ).catch((): GoalLinks | null => null),
    learn ? loadAimChoices(learn).catch(() => null) : null,
    loadShaping(client, goalId),
    loadGoalRuns(client, goalId),
    isOwner({ user }),
  ]);
  if (!map) notFound();
  const shapeable = map.goal.status === 'open' || map.goal.status === 'proposed';
  const linkedAims = new Set(links?.aims.map((aim) => aim.aimId));
  const aimChoices = aims?.filter((aim) => !linkedAims.has(aim.id)) ?? null;

  // Each section drawn above the steps only once it holds something; the empty
  // ones share one row of add lines instead (plan #1038).
  const number = {
    goalId: map.goal.id,
    unit: map.goal.unit,
    target: map.goal.target,
    readings,
    today,
  };
  const help = { goalId: map.goal.id, helpKinds: map.goal.helpKinds ?? [] };
  const linked = { goalId: map.goal.id, links, aimChoices, jobsOn };
  const numberEmpty = !number.unit && readings.length === 0;
  const helpEmpty = help.helpKinds.length === 0;
  const linksEmpty = links !== null && noLinks(links);
  const canLink = (aimChoices?.length ?? 0) > 0 || jobsOn;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/goals"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> {map.areaName}
      </Link>
      <PageHeader
        title={map.goal.title}
        description={map.goal.acceptance ?? undefined}
      />
      {map.goal.fog && (
        <GoalFog
          goalId={map.goal.id}
          fog={map.goal.fog}
          aside={Boolean(map.goal.fogDismissedAt)}
        />
      )}
      <div className="space-y-6">
        {shapeable && (
          <GoalShaping
            goalId={map.goal.id}
            {...shapingLines(map.goal.status, map.steps, shaping.approvedAt, history, account.timezone)}
            canRun={owner}
          />
        )}
        {!numberEmpty && <GoalNumber {...number} />}
        {!helpEmpty && <GoalHelp {...help} />}
        {!linksEmpty && <GoalLinksSection {...linked} />}
        <GoalAddRow
          number={numberEmpty ? number : null}
          help={helpEmpty ? help : null}
          links={linksEmpty && canLink ? linked : null}
        />
        <StepTree map={map} todoOn={moduleEnabled(account, 'todo')} />
        {/* The goal's own thread (plan #957). Each step has its own, under its details. */}
        <Card padding="dense">
          <GoalThread
            itemId={map.goal.id}
            thread={map.threads[map.goal.id] ?? []}
            label="Comment on this goal"
            placeholder="A note on the goal. Tag @dash to ask about it, or to give it figures to file."
          />
        </Card>
      </div>
    </div>
  );
}

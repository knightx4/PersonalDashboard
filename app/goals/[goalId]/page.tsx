import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { weekInstants, type GoalLinks } from '@/lib/goals/links';
import { loadAimChoices, loadGoalLinks } from '@/lib/goals/links-store';
import { loadReadings } from '@/lib/goals/readings-store';
import { loadGoalMap } from '@/lib/goals/steps-store';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { todayIn } from '@/lib/todo/tasks/model';
import { GoalLinksSection } from './goal-links';
import { GoalNumber } from './goal-number';
import { StepTree } from './step-tree';

export const metadata = { title: 'Goal' };
export const dynamic = 'force-dynamic';

/**
 * The full tree of one goal (docs/GOALS-SPEC.md, "The daily view"; plan
 * #925): every step and sub-step under it, and the steps from other goals
 * that also count towards it. One tap from the home, and meant for looking at
 * the whole map rather than for the daily visit.
 */
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
  const [map, readings, links, aims] = await Promise.all([
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
  ]);
  if (!map) notFound();
  const linkedAims = new Set(links?.aims.map((aim) => aim.aimId));
  const aimChoices = aims?.filter((aim) => !linkedAims.has(aim.id)) ?? null;

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
        description={map.goal.acceptance ?? map.goal.fog ?? undefined}
      />
      <div className="space-y-6">
        <GoalNumber
          goalId={map.goal.id}
          unit={map.goal.unit}
          target={map.goal.target}
          readings={readings}
          today={today}
        />
        <GoalLinksSection
          goalId={map.goal.id}
          links={links}
          aimChoices={aimChoices}
          jobsOn={jobsOn}
        />
        <StepTree map={map} todoOn={moduleEnabled(account, 'todo')} />
      </div>
    </div>
  );
}

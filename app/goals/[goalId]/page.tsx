import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadReadings } from '@/lib/goals/readings-store';
import { loadGoalMap } from '@/lib/goals/steps-store';
import { todayIn } from '@/lib/todo/tasks/model';
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
  const [map, readings] = await Promise.all([
    loadGoalMap(client, goalId, { userId: user.id, today }),
    loadReadings(client, goalId),
  ]);
  if (!map) notFound();

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
        <StepTree map={map} todoOn={moduleEnabled(account, 'todo')} />
      </div>
    </div>
  );
}

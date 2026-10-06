import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { isOwner } from '@/lib/dev/owner';
import type { LinkedFile } from '@/lib/files/files';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadDashArrivals } from '@/lib/goals/dash-arrivals-store';
import { loadFilesOf } from '@/lib/goals/files-store';
import { summariseProgress, type ProgressEntry } from '@/lib/goals/progress';
import { loadProgressEntries } from '@/lib/goals/progress-store';
import { stepRunViews, type GoalRun } from '@/lib/goals/shaping';
import { loadStepRuns } from '@/lib/goals/shaping-store';
import type { StepNode } from '@/lib/goals/steps';
import { loadGoalMap } from '@/lib/goals/steps-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { StepPage } from '../../step-page';

export const metadata = { title: 'Step' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

/** The step with this id among the goal's own steps, at any depth. */
function findStep(nodes: readonly StepNode[], id: string): StepNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findStep(node.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Every step of the goal, at any depth. More than the page draws, since a
 * step's draft can come from a prep step beside it rather than beneath it.
 */
function allSteps(nodes: readonly StepNode[]): StepNode[] {
  return nodes.flatMap((node) => [node, ...allSteps(node.children)]);
}

/** Each sent step's run line. Outside the component because it reads the clock. */
function stepRunLines(runs: Record<string, GoalRun>) {
  return stepRunViews(runs, Date.now());
}

/**
 * A step's own page (plan #1620): the step with its sub-steps, drawn as its
 * row on the goal page is, opened. Read the way the goal page reads its
 * steps (loadGoalMap), with the runs, files, progress and arrivals of the
 * goal's steps on top, so the row has the same facts behind it.
 *
 * A step that is not one of this goal's own, including a step from another
 * goal linked into it, is a 404: its page is under its own goal.
 */
export default async function StepOwnPage({
  params,
}: {
  params: Promise<{ goalId: string; stepId: string }>;
}) {
  const { goalId, stepId } = await params;
  if (!UUID.test(goalId) || !UUID.test(stepId)) notFound();

  const user = await requireUser();
  const account = await loadAccountSettings(user.id);
  const today = todayIn(account.timezone);
  const client = await createGoalsClient();
  const [map, owner] = await Promise.all([
    loadGoalMap(client, goalId, { userId: user.id, today }),
    isOwner({ user }),
  ]);
  if (!map) notFound();
  const step = findStep(map.steps, stepId);
  if (!step) notFound();

  const steps = allSteps(map.steps);
  const ids = steps.map((node) => node.id);
  const done = steps.filter((node) => node.status === 'done').map((node) => node.id);
  const core = await createCoreClient();
  // A failed read leaves its part out rather than the page, as on the goal page.
  const [runs, filesOf, entries, arrivals] = await Promise.all([
    loadStepRuns(client, ids).catch((): Record<string, GoalRun> => ({})),
    loadFilesOf(client, core, ids).catch((): Record<string, LinkedFile[]> => ({})),
    loadProgressEntries(client, ids).catch((): ProgressEntry[] => []),
    loadDashArrivals(client, done).catch((): string[] => []),
  ]);

  return (
    <StepPage
      map={map}
      stepId={step.id}
      todoOn={moduleEnabled(account, 'todo')}
      runs={stepRunLines(runs)}
      files={filesOf}
      progress={summariseProgress(entries)}
      arrivals={arrivals}
      canRun={owner}
    />
  );
}

import 'server-only';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadStartedGoalRuns } from '@/lib/goals/runs-store';
import { goalsStatus, type GoalsStatus } from '@/lib/goals/runner-status';
import { loadGoalsNight } from '@/inngest/goals/overnight';

/**
 * The goals half of the runner, as both pages that draw its card read it:
 * Dev Home's Status panel, and the plan page, whose Goals Dash says what the
 * goals run is on (plan #1704). Null when the goal runs could not be read, so
 * a failed read leaves the card as it was rather than taking the page down.
 */
export async function loadRunnerGoals(input: {
  userId: string;
  /** When the plan runner's night started, or null for none. */
  nightStartedAt: string | null;
  now: number;
}): Promise<GoalsStatus | null> {
  try {
    const client = await createGoalsClient();
    const [started, night] = await Promise.all([
      loadStartedGoalRuns(client),
      loadGoalsNight(client, input.userId, input.now),
    ]);
    return goalsStatus({ started, night, nightStartedAt: input.nightStartedAt, now: input.now });
  } catch (error) {
    console.error(`Dash could not read the goal runs: ${(error as Error).message}`);
    return null;
  }
}

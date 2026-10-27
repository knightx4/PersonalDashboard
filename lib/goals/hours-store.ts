import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { HoursMetric } from '@/lib/goals/hours';
import { loggedHourDays } from '@/lib/goals/metrics';
import { loadGoalSteps, loadLoggedEntries } from '@/lib/goals/metrics-store';

/**
 * The live hours metrics on open goals, each with the hours logged on its
 * goal and the steps under it, for the Hours page (migration goals 0089). The
 * client decides whose rows are seen, as everywhere in Goals. Metrics come in
 * the order they were added.
 */
type Row = {
  id: string;
  goal_id: string;
  name: string;
  target: number | null;
  target_high: number | null;
};

type GoalRow = { id: string; title: string; status: string; archived_at: string | null };

export async function loadHoursMetrics(client: GoalsSupabaseClient): Promise<HoursMetric[]> {
  const { data, error } = await client
    .from('metrics')
    .select('id, goal_id, name, target, target_high')
    .eq('source', 'hours')
    .is('archived_at', null)
    .order('created_at');
  if (error) throw new Error(`Could not read the hours metrics: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const goalIds = [...new Set(rows.map((row) => row.goal_id))];
  const goals = await client
    .from('items')
    .select('id, title, status, archived_at')
    .in('id', goalIds);
  if (goals.error) throw new Error(`Could not read the goals: ${goals.error.message}`);
  const byId = new Map(((goals.data ?? []) as GoalRow[]).map((goal) => [goal.id, goal]));
  const live = rows.filter((row) => {
    const goal = byId.get(row.goal_id);
    return goal && !goal.archived_at && goal.status === 'open';
  });

  const daysByGoal = new Map<string, HoursMetric['days']>();
  for (const goalId of new Set(live.map((row) => row.goal_id))) {
    const steps = await loadGoalSteps(client, goalId);
    const entries = await loadLoggedEntries(client, [goalId, ...steps.map((step) => step.id)]);
    daysByGoal.set(
      goalId,
      loggedHourDays(entries).map(({ day, amount }) => ({ day, hours: amount })),
    );
  }

  return live.map((row) => ({
    id: row.id,
    name: row.name,
    goalId: row.goal_id,
    goalTitle: byId.get(row.goal_id)?.title ?? '',
    target: row.target,
    targetHigh: row.target_high,
    days: daysByGoal.get(row.goal_id) ?? [],
  }));
}

import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  hoursDayEntries,
  type DayEntryRow,
  type HoursEntry,
  type HoursGoalTree,
  type HoursMetric,
} from '@/lib/goals/hours';
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

/** The live hours metrics, on goals still open, with each goal's row. */
async function loadLiveHoursMetrics(
  client: GoalsSupabaseClient,
): Promise<{ rows: Row[]; goals: Map<string, GoalRow> }> {
  const { data, error } = await client
    .from('metrics')
    .select('id, goal_id, name, target, target_high')
    .eq('source', 'hours')
    .is('archived_at', null)
    .order('created_at');
  if (error) throw new Error(`Could not read the hours metrics: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { rows: [], goals: new Map() };

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
  return { rows: live, goals: byId };
}

export async function loadHoursMetrics(client: GoalsSupabaseClient): Promise<HoursMetric[]> {
  const { rows: live, goals: byId } = await loadLiveHoursMetrics(client);

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

/**
 * The hours logged on one day across the goals the Hours page counts (plan
 * #2907.2): each live entry in a unit of time on an hours goal or a step
 * under it, with its goal, its step and what was written. Entries taken back
 * are left out, as the page's totals leave them out.
 */
export async function loadHoursDayEntries(
  client: GoalsSupabaseClient,
  day: string,
): Promise<HoursEntry[]> {
  const { rows: live, goals: byId } = await loadLiveHoursMetrics(client);
  const goalIds = [...new Set(live.map((row) => row.goal_id))];
  if (goalIds.length === 0) return [];

  const stepsByGoal = new Map<string, string[]>();
  for (const goalId of goalIds) {
    stepsByGoal.set(goalId, (await loadGoalSteps(client, goalId)).map((step) => step.id));
  }
  const stepIds = [...new Set([...stepsByGoal.values()].flat())];
  const titles = new Map<string, string>();
  if (stepIds.length > 0) {
    const { data, error } = await client.from('items').select('id, title').in('id', stepIds);
    if (error) throw new Error(`Could not read the steps: ${error.message}`);
    for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
  }

  const { data, error } = await client
    .from('progress_entries')
    .select('id, item_id, text, quantity, unit, created_at')
    .eq('happened_on', day)
    .in('item_id', [...goalIds, ...stepIds])
    .is('undone_at', null)
    .not('quantity', 'is', null);
  if (error) throw new Error(`Could not read the hours logged: ${error.message}`);

  const trees: HoursGoalTree[] = goalIds.map((goalId) => ({
    goalId,
    goalTitle: byId.get(goalId)?.title ?? '',
    steps: new Map((stepsByGoal.get(goalId) ?? []).map((id) => [id, titles.get(id) ?? ''])),
  }));
  return hoursDayEntries((data ?? []) as DayEntryRow[], trees);
}

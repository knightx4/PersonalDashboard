import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  lastWeekOf,
  needsPlanning,
  plannable,
  weekOf,
  type PlanWeekGoal,
  type WeekRecap,
} from '@/lib/goals/focus';

export type { PlanWeekGoal, WeekRecap };

/**
 * Reads and writes for the week's focus (docs/GOALS-SPEC.md, "The week's
 * focus"; goals 0070). The rules are in lib/goals/focus.ts.
 *
 * Every call takes the signed-in goals client: row level security keeps the
 * rows to the person, and the items_focus_guard trigger refuses a change of
 * focus made as Dash, so nothing here is for a run to call.
 */

/** Everything the Plan your week card and the focus line need, from loadPlanWeek. */
export type PlanWeekData = {
  /** The Monday of this week, YYYY-MM-DD. */
  week: string;
  /** The Monday of the last week the person planned, or null for never. */
  plannedWeek: string | null;
  /** Whether the home should show the card: no plan for this week yet. */
  needsPlanning: boolean;
  /** Open goals that are not errands, in page order, with their focus. */
  goals: PlanWeekGoal[];
  /** The goals with focus now, for the focus line. Empty when none has it. */
  focused: PlanWeekGoal[];
  recap: WeekRecap;
};

/** The Monday of the last week the person planned, or null when they never have. */
export async function loadPlannedWeek(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('visits')
    .select('planned_week')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read when you last planned a week: ${error.message}`);
  return ((data as { planned_week: string | null } | null)?.planned_week ?? null) as string | null;
}

/**
 * Last week's recap: steps of yours closed between last Monday and this one,
 * and the rhythm periods that ended in that span. A period not yet closed by
 * the rhythm sync is read as kept when its count reached its target. The
 * week's edges are read in UTC, which can move a step closed near midnight
 * by a day.
 */
async function loadRecap(
  client: GoalsSupabaseClient,
  userId: string,
  today: string,
): Promise<WeekRecap> {
  const from = lastWeekOf(today);
  const to = weekOf(today);
  const [steps, periods] = await Promise.all([
    client
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('level', 'step')
      .eq('kind', 'mine')
      .eq('status', 'done')
      .gte('closed_at', `${from}T00:00:00Z`)
      .lt('closed_at', `${to}T00:00:00Z`),
    client
      .from('periods')
      .select('target, count, kept')
      .eq('user_id', userId)
      .gt('ends_on', from)
      .lte('ends_on', to),
  ]);
  if (steps.error) throw new Error(`Could not count last week's steps: ${steps.error.message}`);
  if (periods.error) throw new Error(`Could not read last week's rhythms: ${periods.error.message}`);
  let rhythmsKept = 0;
  let rhythmsMissed = 0;
  for (const row of (periods.data ?? []) as { target: number; count: number; kept: boolean | null }[]) {
    if (row.kept ?? row.count >= row.target) rhythmsKept += 1;
    else rhythmsMissed += 1;
  }
  return { stepsClosed: steps.count ?? 0, rhythmsKept, rhythmsMissed };
}

/**
 * Everything the Plan your week card and the focus line need, in one call
 * for the home page. Three reads in parallel: the open goals, the visit row
 * and last week's recap (two queries).
 */
export async function loadPlanWeek(
  client: GoalsSupabaseClient,
  { userId, today }: { userId: string; today: string },
): Promise<PlanWeekData> {
  const [goalRows, plannedWeek, recap] = await Promise.all([
    client
      .from('items')
      .select('id, title, status, focus, errand, due_on')
      .eq('user_id', userId)
      .eq('level', 'goal')
      .eq('status', 'open')
      .is('archived_at', null)
      .order('position')
      .order('created_at'),
    loadPlannedWeek(client, userId),
    loadRecap(client, userId, today),
  ]);
  if (goalRows.error) throw new Error(`Could not read your goals: ${goalRows.error.message}`);
  const rows = (goalRows.data ?? []) as {
    id: string;
    title: string;
    status: 'open';
    focus: boolean | null;
    errand: boolean | null;
    due_on: string | null;
  }[];
  const goals = plannable(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      focus: row.focus ?? false,
      errand: row.errand ?? false,
      dueOn: row.due_on,
    })),
  ).map(({ id, title, focus }) => ({ id, title, focus: focus ?? false }));
  return {
    week: weekOf(today),
    plannedWeek,
    needsPlanning: needsPlanning(plannedWeek, today),
    goals,
    focused: goals.filter((goal) => goal.focus),
    recap,
  };
}

/**
 * Turn one goal's focus on or off. Only an open goal can take focus; taking
 * it off works on any goal, so none is stranded with it. False when nothing
 * changed.
 */
export async function setGoalFocus(
  client: GoalsSupabaseClient,
  id: string,
  focus: boolean,
): Promise<boolean> {
  let query = client
    .from('items')
    .update({ focus })
    .eq('id', id)
    .eq('level', 'goal')
    .eq('focus', !focus)
    .is('archived_at', null);
  if (focus) query = query.eq('status', 'open');
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Save the week's plan: focus on the chosen goals, off on every other goal
 * that has it, and this Monday written as the week planned. An empty choice
 * is a week with no focus, so every goal counts again. Only the rows whose
 * focus changes are written, so the history records the choice and nothing
 * else.
 */
export async function planWeek(
  client: GoalsSupabaseClient,
  { userId, goalIds, today }: { userId: string; goalIds: string[]; today: string },
): Promise<void> {
  const chosen = [...new Set(goalIds)];
  let clear = client
    .from('items')
    .update({ focus: false })
    .eq('user_id', userId)
    .eq('level', 'goal')
    .eq('focus', true);
  if (chosen.length > 0) clear = clear.not('id', 'in', `(${chosen.join(',')})`);
  const cleared = await clear;
  if (cleared.error) throw new Error(`Could not clear last week's focus: ${cleared.error.message}`);

  if (chosen.length > 0) {
    const set = await client
      .from('items')
      .update({ focus: true })
      .eq('user_id', userId)
      .eq('level', 'goal')
      .eq('status', 'open')
      .eq('focus', false)
      .is('archived_at', null)
      .in('id', chosen);
    if (set.error) throw new Error(`Could not set this week's focus: ${set.error.message}`);
  }

  // Only planned_week is named, so an existing row keeps its visit record;
  // a first row takes the table's default for last_visit_at.
  const { error } = await client
    .from('visits')
    .upsert({ user_id: userId, planned_week: weekOf(today) }, { onConflict: 'user_id' });
  if (error) throw new Error(`Could not record this week's plan: ${error.message}`);
}

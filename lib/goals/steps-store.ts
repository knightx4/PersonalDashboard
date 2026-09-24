import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { dailyView, type DailyView } from '@/lib/goals/daily';
import { GOALS_SCHEMA, type GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  buildForest,
  type LinkedStep,
  type RhythmPeriod,
  type Step,
  type StepFields,
  type StepKind,
  type StepNode,
} from '@/lib/goals/steps';
import {
  atRiskRhythms,
  liveRhythms,
  type AtRiskRhythm,
  type LiveRhythm,
  type RhythmRecord,
} from '@/lib/goals/rhythms';
import { syncRhythms } from '@/lib/goals/rhythms-store';
import { todoSteps, type TodoStep } from '@/lib/goals/todo';
import { nextPosition, reorder, type Goal, type GoalStatus } from '@/lib/goals/tree';

/**
 * Reads and writes for the step tree under a goal (plan #925).
 *
 * As in lib/goals/store.ts: every call takes the signed-in goals client, so
 * row level security decides whose rows are seen and the table triggers write
 * the history. Nothing is deleted. Archiving a step sets archived_at on that
 * step alone; its sub-steps drop out of view with it because the tree is
 * built downwards from live rows, and come back when it does.
 */

type ItemRow = {
  id: string;
  level: 'goal' | 'step';
  area_id: string | null;
  parent_id: string | null;
  kind: StepKind | null;
  status: GoalStatus;
  title: string;
  detail: string | null;
  acceptance: string | null;
  fog: string | null;
  resolution: string | null;
  due_on: string | null;
  position: number;
  rhythm_count: number | null;
  rhythm_period: RhythmPeriod | null;
  on_todo: boolean;
  unit: string | null;
  target: number | string | null;
};

type LinkRow = { id: string; item_id: string; goal_id: string };

const ITEM_COLUMNS =
  'id, level, area_id, parent_id, kind, status, title, detail, acceptance, fog, resolution, ' +
  'due_on, position, rhythm_count, rhythm_period, on_todo, unit, target';

const toStep = (row: ItemRow): Step => ({
  id: row.id,
  parentId: row.parent_id as string,
  kind: row.kind as StepKind,
  status: row.status,
  title: row.title,
  detail: row.detail,
  acceptance: row.acceptance,
  resolution: row.resolution,
  dueOn: row.due_on,
  position: row.position,
  rhythmCount: row.rhythm_count,
  rhythmPeriod: row.rhythm_period,
  onTodo: row.on_todo,
});

const toGoal = (row: ItemRow): Goal => ({
  id: row.id,
  areaId: row.area_id as string,
  title: row.title,
  acceptance: row.acceptance,
  fog: row.fog,
  status: row.status,
  position: row.position,
  unit: row.unit,
  target: row.target === null ? null : Number(row.target),
});

export type GoalMap = {
  goal: Goal;
  areaName: string;
  steps: StepNode[];
  /** Steps under other goals that also count towards this one. */
  linked: LinkedStep[];
  /** Every other live goal, for linking a step to one of them. */
  otherGoals: { id: string; title: string }[];
  /** For each step shown, the other goals it is linked to. */
  linksOf: Record<string, { linkId: string; goalId: string; title: string }[]>;
  /** Each rhythm step's current period and the closed ones before it (plan #928). */
  rhythms: Record<string, RhythmRecord>;
};

/** Whose rows, and which day it is for them, for bringing rhythm periods up to date. */
export type Today = { userId: string; today: string };

/**
 * One goal and everything under it, or null when it is not a live goal of
 * yours. Reads every live goal and step at once: a person's goals run to
 * hundreds of rows, not thousands, and a step linked in from another goal
 * needs that goal's tree to know it is still live and what sits beneath it.
 */
export async function loadGoalMap(
  client: GoalsSupabaseClient,
  goalId: string,
  { userId, today }: Today,
): Promise<GoalMap | null> {
  const [items, links, areas] = await Promise.all([
    client
      .from('items')
      .select(ITEM_COLUMNS)
      .is('archived_at', null)
      .order('position')
      .order('created_at'),
    client.from('item_goals').select('id, item_id, goal_id').is('archived_at', null),
    client.from('areas').select('id, name').is('archived_at', null),
  ]);
  assertSchemaExposed(items.error, GOALS_SCHEMA);
  if (items.error) throw new Error(`Could not read steps: ${items.error.message}`);
  if (links.error) throw new Error(`Could not read links: ${links.error.message}`);
  if (areas.error) throw new Error(`Could not read areas: ${areas.error.message}`);

  const rows = (items.data ?? []) as unknown as ItemRow[];
  const areaNames = new Map((areas.data ?? []).map((a) => [a.id as string, a.name as string]));
  // A goal in an archived area is out of view with it.
  const goals = rows.filter((r) => r.level === 'goal' && areaNames.has(r.area_id as string));
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return null;

  const { byGoal, goalOf, nodes } = buildForest(
    goals.map((g) => g.id),
    rows.filter((r) => r.level === 'step').map(toStep),
  );
  const titles = new Map(goals.map((g) => [g.id, g.title]));

  const linked: LinkedStep[] = [];
  const linksOf: GoalMap['linksOf'] = {};
  for (const link of (links.data ?? []) as LinkRow[]) {
    const step = nodes.get(link.item_id);
    const target = titles.get(link.goal_id);
    // Either end out of view (archived, or under something archived): the
    // link is kept and simply not shown.
    if (!step || target === undefined) continue;
    const list = linksOf[link.item_id] ?? [];
    list.push({ linkId: link.id, goalId: link.goal_id, title: target });
    linksOf[link.item_id] = list;
    if (link.goal_id === goalId) {
      const from = goalOf.get(link.item_id) as string;
      linked.push({ linkId: link.id, fromGoal: { id: from, title: titles.get(from) ?? '' }, step });
    }
  }

  const steps = byGoal.get(goalId) ?? [];
  const shown: string[] = [];
  const collect = (list: StepNode[]) => {
    for (const node of list) {
      if (node.kind === 'rhythm') shown.push(node.id);
      collect(node.children);
    }
  };
  collect(steps);
  collect(linked.map((entry) => entry.step));
  const records = await syncRhythms(
    client,
    userId,
    liveRhythms(goals.map(toGoal), byGoal),
    today,
    shown,
  );

  return {
    goal: toGoal(goal),
    areaName: areaNames.get(goal.area_id as string) ?? '',
    steps,
    linked,
    otherGoals: goals.filter((g) => g.id !== goalId).map((g) => ({ id: g.id, title: g.title })),
    linksOf,
    rhythms: Object.fromEntries(
      shown.flatMap((id) => {
        const record = records.get(id);
        return record ? [[id, record]] : [];
      }),
    ),
  };
}

/** Live step and goal counts per goal, for the home page's link to each map. */
export async function loadStepCounts(
  client: GoalsSupabaseClient,
): Promise<Record<string, { total: number; open: number }>> {
  const { data, error } = await client
    .from('items')
    .select('id, level, parent_id, status')
    .is('archived_at', null);
  if (error) throw new Error(`Could not read steps: ${error.message}`);
  const rows = (data ?? []) as Pick<ItemRow, 'id' | 'level' | 'parent_id' | 'status'>[];
  const goalIds = rows.filter((r) => r.level === 'goal').map((r) => r.id);
  const { goalOf } = buildForest(
    goalIds,
    rows
      .filter((r) => r.level === 'step')
      .map((r) => ({ id: r.id, parentId: r.parent_id as string, status: r.status }) as Step),
  );
  const counts: Record<string, { total: number; open: number }> = {};
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  for (const [stepId, goalId] of goalOf) {
    const entry = counts[goalId] ?? { total: 0, open: 0 };
    entry.total += 1;
    const status = statusOf.get(stepId);
    if (status === 'open' || status === 'proposed') entry.open += 1;
    counts[goalId] = entry;
  }
  return counts;
}

/**
 * A new step at the end of its siblings, returning its id. The parent is a
 * live goal or step of yours; null when it is not.
 */
export async function insertStep(
  client: GoalsSupabaseClient,
  userId: string,
  parentId: string,
  fields: StepFields & { title: string; kind: StepKind },
): Promise<string | null> {
  const { data: parent, error: parentError } = await client
    .from('items')
    .select('id')
    .eq('id', parentId)
    .is('archived_at', null)
    .maybeSingle();
  if (parentError) throw new Error(parentError.message);
  if (!parent) return null;

  const { data: siblings, error: readError } = await client
    .from('items')
    .select('position')
    .eq('parent_id', parentId)
    .is('archived_at', null);
  if (readError) throw new Error(readError.message);

  const { data, error } = await client.from('items').insert({
    user_id: userId,
    level: 'step',
    parent_id: parentId,
    ...fields,
    position: nextPosition((siblings ?? []).map((row) => row.position as number)),
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** False when no live step has that id. */
export async function updateStep(
  client: GoalsSupabaseClient,
  id: string,
  fields: StepFields,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update(fields)
    .eq('id', id)
    .eq('level', 'step')
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Close a step as done or dropped, or reopen it. closed_at follows by
 * trigger. False when it is not a live step or already in that state.
 */
export async function setStepStatus(
  client: GoalsSupabaseClient,
  id: string,
  status: 'open' | 'done' | 'dropped',
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ status })
    .eq('id', id)
    .eq('level', 'step')
    .neq('status', status)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Archive a step, or bring it back. Its sub-steps are left as they are. */
export async function setStepArchived(
  client: GoalsSupabaseClient,
  id: string,
  archived: boolean,
): Promise<boolean> {
  let query = client
    .from('items')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('level', 'step');
  query = archived ? query.is('archived_at', null) : query.not('archived_at', 'is', null);
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** One place up or down among its siblings. False when already at that end. */
export async function moveStep(
  client: GoalsSupabaseClient,
  id: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  const { data: step, error: readError } = await client
    .from('items')
    .select('parent_id')
    .eq('id', id)
    .eq('level', 'step')
    .is('archived_at', null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!step) return false;

  const { data: siblings, error } = await client
    .from('items')
    .select('id')
    .eq('parent_id', step.parent_id as string)
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  if (error) throw new Error(error.message);

  const order = reorder(
    (siblings ?? []).map((row) => row.id as string),
    id,
    direction,
  );
  if (!order) return false;
  const results = await Promise.all(
    order.map((sid, i) =>
      client
        .from('items')
        .update({ position: (i + 1) * 10 })
        .eq('id', sid),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  return true;
}

/**
 * Count a step towards another goal. A link removed earlier is brought back
 * rather than written twice. The database refuses a goal the step already
 * sits under, and a goal or step that is not yours.
 */
export async function linkStep(
  client: GoalsSupabaseClient,
  userId: string,
  stepId: string,
  goalId: string,
): Promise<void> {
  const { data: existing, error: readError } = await client
    .from('item_goals')
    .select('id, archived_at')
    .eq('item_id', stepId)
    .eq('goal_id', goalId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) {
    if (existing.archived_at === null) return;
    const { error } = await client
      .from('item_goals')
      .update({ archived_at: null })
      .eq('id', existing.id as string);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await client
    .from('item_goals')
    .insert({ user_id: userId, item_id: stepId, goal_id: goalId });
  if (error) throw new Error(error.message);
}

/** Stop a step counting towards a goal. The link is archived, not deleted. */
export async function unlinkStep(client: GoalsSupabaseClient, linkId: string): Promise<boolean> {
  const { data, error } = await client
    .from('item_goals')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', linkId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Every live goal in page order, area by area, with its area's name and its
 * step tree. A goal in an archived area is out of view with it.
 */
export async function loadLiveTree(
  client: GoalsSupabaseClient,
): Promise<{ goals: { goal: Goal; areaName: string }[]; byGoal: Map<string, StepNode[]> }> {
  const [items, areas] = await Promise.all([
    client
      .from('items')
      .select(ITEM_COLUMNS)
      .is('archived_at', null)
      .order('position')
      .order('created_at'),
    client
      .from('areas')
      .select('id, name')
      .is('archived_at', null)
      .order('position')
      .order('created_at'),
  ]);
  assertSchemaExposed(items.error, GOALS_SCHEMA);
  if (items.error) throw new Error(`Could not read steps: ${items.error.message}`);
  if (areas.error) throw new Error(`Could not read areas: ${areas.error.message}`);

  const rows = (items.data ?? []) as unknown as ItemRow[];
  const goalsByArea = new Map<string, ItemRow[]>();
  for (const row of rows) {
    if (row.level !== 'goal') continue;
    const list = goalsByArea.get(row.area_id as string) ?? [];
    list.push(row);
    goalsByArea.set(row.area_id as string, list);
  }
  const goals = (areas.data ?? []).flatMap((area) =>
    (goalsByArea.get(area.id as string) ?? []).map((row) => ({
      goal: toGoal(row),
      areaName: area.name as string,
    })),
  );

  const { byGoal } = buildForest(
    goals.map((g) => g.goal.id),
    rows.filter((r) => r.level === 'step').map(toStep),
  );
  return { goals, byGoal };
}

/**
 * Everything the daily view on the home needs (plan #926). The selection
 * itself is dailyView in lib/goals/daily.ts.
 */
export async function loadDailyView(
  client: GoalsSupabaseClient,
  { userId, today }: Today,
): Promise<DailyView & { atRisk: AtRiskRhythm[] }> {
  const { goals, byGoal } = await loadLiveTree(client);
  const live = liveRhythms(
    goals.map((g) => g.goal),
    byGoal,
  );
  const records = await syncRhythms(client, userId, live, today);
  return { ...dailyView(goals, byGoal), atRisk: atRiskRhythms(live, records, today) };
}

/** A live rhythm whose current period is not yet met, for Todo (plan #928). */
export type TodoRhythm = LiveRhythm & { startsOn: string; count: number };

/**
 * What Goals puts on Todo, for the agenda source in
 * lib/todo/agenda/sources/goal-steps.ts: the steps you pressed Show on Todo
 * on (plan #927; the rule is todoSteps in lib/goals/todo.ts), and every live
 * rhythm until its current period's count is met (plan #928). Rhythms need no
 * flag, as the spec says; "Not this one" on Todo hides only this period.
 */
export async function loadTodoGoals(
  client: GoalsSupabaseClient,
  { userId, today }: Today,
): Promise<{ steps: TodoStep[]; rhythms: TodoRhythm[] }> {
  const { goals, byGoal } = await loadLiveTree(client);
  const goalList = goals.map((g) => g.goal);
  const live = liveRhythms(goalList, byGoal);
  const records = await syncRhythms(client, userId, live, today);
  const rhythms = live.flatMap((rhythm) => {
    const current = records.get(rhythm.id)?.current;
    if (!current || current.count >= current.target) return [];
    return [
      { ...rhythm, target: current.target, startsOn: current.startsOn, count: current.count },
    ];
  });
  return { steps: todoSteps(goalList, byGoal), rhythms };
}

/**
 * Show a step on Todo, or take it off. Only your own open steps can go on:
 * the database allows the flag on any step, and this is where "yours" is
 * kept. Taking one off works whatever it is, so nothing can be stranded
 * there. False when nothing changed.
 */
export async function setStepOnTodo(
  client: GoalsSupabaseClient,
  id: string,
  onTodo: boolean,
): Promise<boolean> {
  let query = client
    .from('items')
    .update({ on_todo: onTodo })
    .eq('id', id)
    .eq('level', 'step')
    .eq('on_todo', !onTodo)
    .is('archived_at', null);
  if (onTodo) query = query.eq('kind', 'mine').eq('status', 'open');
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

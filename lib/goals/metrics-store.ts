import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { loadListingsById } from '@/lib/files/store';
import { loadRecords, type WriteResult } from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  closedStepDays,
  countByPeriod,
  countDaysByPeriod,
  dashFileDays,
  loggedHourDays,
  metricInputError,
  sumDaysByPeriod,
  type CountedFile,
  type CountedStep,
  type LoggedEntry,
  type Metric,
  type MetricInput,
  type MetricPeriod,
  type MetricSource,
  type PeriodCount,
} from '@/lib/goals/metrics';

/**
 * Reads and writes of goals.metrics (plan #2084.1), following
 * lib/goals/collections-store.ts: the rules are in lib/goals/metrics.ts and
 * every write goes through metricInputError before it is sent. The database
 * checks again that the goal is a goal and the field a live date field of the
 * list.
 *
 * As everywhere in Goals, the client decides whose rows are seen and the
 * table's trigger writes the history. Metrics are archived, never deleted.
 */

type MetricRow = {
  id: string;
  goal_id: string;
  name: string;
  source: MetricSource;
  collection_id: string | null;
  date_field: string | null;
  period: MetricPeriod;
  target: number | null;
  target_high: number | null;
  position: number;
};

const METRIC_COLUMNS =
  'id, goal_id, name, source, collection_id, date_field, period, target, target_high, position';

const toMetric = (row: MetricRow): Metric => ({
  id: row.id,
  goalId: row.goal_id,
  name: row.name,
  source: row.source,
  collectionId: row.collection_id,
  dateField: row.date_field,
  period: row.period,
  target: row.target,
  targetHigh: row.target_high,
  position: row.position,
});

/** Only a list metric keeps a list and a date; the table's check holds it so. */
const toRow = (input: MetricInput) => ({
  name: input.name.trim(),
  source: input.source,
  collection_id: input.source === 'list' ? input.collectionId : null,
  date_field: input.source === 'list' ? input.dateField : null,
  period: input.period,
  target: input.target,
  target_high: input.target === null ? null : (input.targetHigh ?? null),
});

/**
 * A database refusal the person can act on. metrics_check raises
 * check_violation with the column at fault in the detail.
 */
function refusal(error: { code?: string; message: string; details?: string | null }): {
  field: string | null;
  error: string;
} | null {
  if (error.code !== '23514') return null;
  const message = error.message.replace(/^metrics: /, '');
  const field = error.details === 'date_field' ? 'dateField' : null;
  return { field, error: message.charAt(0).toUpperCase() + message.slice(1) };
}

/** The live metrics on one goal, in order. */
export async function loadMetrics(client: GoalsSupabaseClient, goalId: string): Promise<Metric[]> {
  const { data, error } = await client
    .from('metrics')
    .select(METRIC_COLUMNS)
    .eq('goal_id', goalId)
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  if (error) throw new Error(`Could not read the metrics: ${error.message}`);
  return ((data ?? []) as MetricRow[]).map(toMetric);
}

/** Add a metric to a goal, after the ones it has. */
export async function addMetric(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
  input: MetricInput,
): Promise<WriteResult<string>> {
  const problem = metricInputError(input);
  if (problem) return { ok: false, ...problem };

  const existing = await loadMetrics(client, goalId);
  const position = existing.reduce((max, m) => Math.max(max, m.position + 1), 0);
  const { data, error } = await client
    .from('metrics')
    .insert({ user_id: userId, goal_id: goalId, position, ...toRow(input) })
    .select('id')
    .single();
  if (error) {
    const refused = refusal(error);
    if (refused) return { ok: false, ...refused };
    throw new Error(error.message);
  }
  return { ok: true, value: data.id as string };
}

/** Change what a live metric counts. */
export async function updateMetric(
  client: GoalsSupabaseClient,
  metricId: string,
  input: MetricInput,
): Promise<WriteResult<string>> {
  const problem = metricInputError(input);
  if (problem) return { ok: false, ...problem };

  const { data, error } = await client
    .from('metrics')
    .update(toRow(input))
    .eq('id', metricId)
    .is('archived_at', null)
    .select('id');
  if (error) {
    const refused = refusal(error);
    if (refused) return { ok: false, ...refused };
    throw new Error(error.message);
  }
  if ((data ?? []).length === 0) return { ok: false, field: null, error: 'That metric is gone.' };
  return { ok: true, value: metricId };
}

/** Take a metric off its goal. It stays in the history. False when it was already gone. */
export async function archiveMetric(client: GoalsSupabaseClient, metricId: string): Promise<boolean> {
  const { data, error } = await client
    .from('metrics')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', metricId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export type MetricCounts = Metric & { counts: PeriodCount[] };

type StepRow = {
  id: string;
  parent_id: string | null;
  level: string;
  status: string;
  closed_at: string | null;
};

/** A live step under the goal, at any depth, with what a steps metric reads. */
type GoalStep = CountedStep & { id: string };

/**
 * Every live step under a goal, at any depth (plan #2397.2). All live items
 * are read at once, as loadGoalMap does, and walked down from the goal, so a
 * step under an archived step is out of view with it. A step linked in from
 * another goal (goals.item_goals) is that goal's and is not counted here.
 */
export async function loadGoalSteps(client: GoalsSupabaseClient, goalId: string): Promise<GoalStep[]> {
  const { data, error } = await client
    .from('items')
    .select('id, parent_id, level, status, closed_at')
    .is('archived_at', null);
  if (error) throw new Error(`Could not read the goal's steps: ${error.message}`);
  const children = new Map<string, StepRow[]>();
  for (const row of (data ?? []) as StepRow[]) {
    if (row.level !== 'step' || !row.parent_id) continue;
    const list = children.get(row.parent_id) ?? [];
    list.push(row);
    children.set(row.parent_id, list);
  }
  const steps: GoalStep[] = [];
  const seen = new Set<string>([goalId]);
  let frontier = [goalId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const row of children.get(id) ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        steps.push({ id: row.id, status: row.status, closedAt: row.closed_at });
        next.push(row.id);
      }
    }
    frontier = next;
  }
  return steps;
}

type EntryRow = { happened_on: string; quantity: number | string | null; unit: string | null };

/**
 * The live progress entries on the goal and on the given steps under it, as
 * an hours metric reads them (migration goals 0089). Entries taken back are
 * left out here, so loggedHourDays sees only what stands.
 */
export async function loadLoggedEntries(
  client: GoalsSupabaseClient,
  itemIds: string[],
): Promise<LoggedEntry[]> {
  const { data, error } = await client
    .from('progress_entries')
    .select('happened_on, quantity, unit')
    .in('item_id', [...new Set(itemIds)])
    .is('undone_at', null)
    .not('quantity', 'is', null);
  if (error) throw new Error(`Could not read the hours logged: ${error.message}`);
  return ((data ?? []) as EntryRow[]).map((row) => ({
    happenedOn: row.happened_on,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
  }));
}

type FileLinkRow = { target_id: string };

/**
 * The live files linked to the goal or to any of the given steps under it
 * (goals.links, kind 'file'), each once. The file is in core and PostgREST
 * cannot join across schemas, so it is read with the core client.
 */
async function loadGoalFiles(
  client: GoalsSupabaseClient,
  core: CoreSupabaseClient,
  itemIds: string[],
): Promise<CountedFile[]> {
  const { data, error } = await client
    .from('links')
    .select('target_id')
    .eq('kind', 'file')
    .in('item_id', [...new Set(itemIds)])
    .is('archived_at', null);
  if (error) throw new Error(`Could not read the goal's files: ${error.message}`);
  const files = await loadListingsById(
    core,
    ((data ?? []) as FileLinkRow[]).map((row) => row.target_id),
  );
  return [...files.values()].map((file) => ({ id: file.id, madeBy: file.madeBy, createdAt: file.createdAt }));
}

/**
 * Each live metric on a goal with its counts: a list metric from the live
 * records of its list, a steps metric from the steps closed as done under the
 * goal, and a files metric from the files Dash wrote under it (plan #2397.2).
 * `goal.createdAt` is where the periods start unless something counted is
 * earlier; the zone is the account's (loadAccountSettings). The steps and
 * files are read only when a metric counts them.
 */
export async function loadMetricCounts(
  client: GoalsSupabaseClient,
  goal: { id: string; createdAt: string | null },
  timeZone: string,
  { core, now = new Date() }: { core: CoreSupabaseClient; now?: Date },
): Promise<MetricCounts[]> {
  const metrics = await loadMetrics(client, goal.id);
  const lists = new Map<string, Awaited<ReturnType<typeof loadRecords>>>();
  for (const metric of metrics) {
    if (metric.source !== 'list' || !metric.collectionId || lists.has(metric.collectionId)) continue;
    lists.set(metric.collectionId, await loadRecords(client, metric.collectionId));
  }
  // A files metric reads the steps too, for the files linked to them, and an
  // hours metric for the time logged on them.
  const wantsTree = metrics.some((m) => m.source !== 'list');
  const steps = wantsTree ? await loadGoalSteps(client, goal.id) : [];
  const treeIds = [goal.id, ...steps.map((step) => step.id)];
  const files = metrics.some((m) => m.source === 'files') ? await loadGoalFiles(client, core, treeIds) : [];
  const entries = metrics.some((m) => m.source === 'hours') ? await loadLoggedEntries(client, treeIds) : [];

  const daysOf = (metric: Metric): string[] | null => {
    if (metric.source === 'steps') return closedStepDays(steps, timeZone);
    if (metric.source === 'files') return dashFileDays(files, timeZone);
    return null;
  };
  return metrics.map((metric) => {
    const days = daysOf(metric);
    const common = { period: metric.period, goalStartedAt: goal.createdAt, now, timeZone };
    if (metric.source === 'hours') {
      return { ...metric, counts: sumDaysByPeriod({ amounts: loggedHourDays(entries), ...common }) };
    }
    if (days) return { ...metric, counts: countDaysByPeriod({ days, ...common }) };
    if (!metric.collectionId || !metric.dateField) return { ...metric, counts: [] };
    return {
      ...metric,
      counts: countByPeriod({
        records: lists.get(metric.collectionId) ?? [],
        dateField: metric.dateField,
        ...common,
      }),
    };
  });
}

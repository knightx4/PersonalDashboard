import 'server-only';

import { loadRecords, type WriteResult } from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  countByPeriod,
  metricInputError,
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
  position: number;
};

const METRIC_COLUMNS = 'id, goal_id, name, source, collection_id, date_field, period, target, position';

const toMetric = (row: MetricRow): Metric => ({
  id: row.id,
  goalId: row.goal_id,
  name: row.name,
  source: row.source,
  collectionId: row.collection_id,
  dateField: row.date_field,
  period: row.period,
  target: row.target,
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

/**
 * Each live metric on a goal with its counts, worked out from the live
 * records of its list. `goal.createdAt` is where the periods start unless a
 * record is earlier; the zone is the account's (loadAccountSettings).
 */
export async function loadMetricCounts(
  client: GoalsSupabaseClient,
  goal: { id: string; createdAt: string | null },
  timeZone: string,
  now: Date = new Date(),
): Promise<MetricCounts[]> {
  const metrics = await loadMetrics(client, goal.id);
  const lists = new Map<string, Awaited<ReturnType<typeof loadRecords>>>();
  for (const metric of metrics) {
    if (metric.source !== 'list' || !metric.collectionId || lists.has(metric.collectionId)) continue;
    lists.set(metric.collectionId, await loadRecords(client, metric.collectionId));
  }
  return metrics.map((metric) => ({
    ...metric,
    // Counting closed steps and Dash files is plan #2397.2; until then they have none.
    counts: metric.source !== 'list' || !metric.collectionId || !metric.dateField ? [] : countByPeriod({
      records: lists.get(metric.collectionId) ?? [],
      dateField: metric.dateField,
      period: metric.period,
      goalStartedAt: goal.createdAt,
      now,
      timeZone,
    }),
  }));
}

import type { CollectionField } from '@/lib/goals/collections';
import {
  dateFields,
  metricInputError,
  METRIC_PERIODS,
  type Metric,
  type MetricInput,
  type MetricPeriod,
} from '@/lib/goals/metrics';

/**
 * The metric form in a goal's properties column (plan #2084.3): which lists
 * it offers, how it reads what was sent, and the line each metric shows. The
 * server actions in app/goals/[goalId]/metric-actions.ts read the form with
 * `parseMetricForm` against the goal's own lists, as the number's actions
 * read theirs (reading-actions.ts), so a list the goal does not hold or a
 * field that is not one of its dates is refused before it is sent.
 */

/** A list a metric can count, with the dates it can count by. */
export type MetricList = {
  id: string;
  name: string;
  dateFields: { key: string; label: string }[];
};

/** The goal's lists as the form offers them, in the order they were read. */
export function metricLists(
  collections: { id: string; name: string; fields: CollectionField[] }[],
): MetricList[] {
  return collections.map((c) => ({
    id: c.id,
    name: c.name,
    dateFields: dateFields(c.fields).map((f) => ({ key: f.key, label: f.label })),
  }));
}

/** Whether any list on the goal has a date to count by. */
export function canCountAny(lists: MetricList[]): boolean {
  return lists.some((list) => list.dateFields.length > 0);
}

export type MetricFormResult =
  | { ok: true; value: MetricInput }
  | { ok: false; field: keyof MetricInput | null; error: string };

const text = (value: FormDataEntryValue | null): string =>
  typeof value === 'string' ? value.trim() : '';

/** Read the form against the goal's lists. */
export function parseMetricForm(
  get: (key: string) => FormDataEntryValue | null,
  lists: MetricList[],
): MetricFormResult {
  const targetText = text(get('target'));
  let target: number | null = null;
  if (targetText) {
    if (!/^\d+$/.test(targetText)) {
      return { ok: false, field: 'target', error: 'The target is a whole number of at least 1.' };
    }
    target = Number(targetText);
  }
  const period = text(get('period'));
  const input: MetricInput = {
    name: text(get('name')),
    collectionId: text(get('collectionId')),
    dateField: text(get('dateField')),
    period: (METRIC_PERIODS as readonly string[]).includes(period)
      ? (period as MetricPeriod)
      : ('' as MetricPeriod),
    target,
  };

  // The list comes first: the date only means something once the list is right.
  if (input.name && input.collectionId) {
    const list = lists.find((l) => l.id === input.collectionId);
    if (!list) return { ok: false, field: 'collectionId', error: 'That list is not on this goal.' };
    if (list.dateFields.length === 0) {
      return { ok: false, field: 'collectionId', error: `${list.name} has no date to count by.` };
    }
    if (input.dateField && !list.dateFields.some((f) => f.key === input.dateField)) {
      return {
        ok: false,
        field: 'dateField',
        error: `That date is no longer in ${list.name}. Choose another.`,
      };
    }
  }
  const problem = metricInputError(input);
  if (problem) return { ok: false, ...problem };
  return { ok: true, value: input };
}

/**
 * What a metric counts, under its name: "Applications · Applied on ·
 * weekly · aim 5". A list or a date gone from the goal is said, not hidden.
 */
export function metricLine(metric: Metric, lists: MetricList[]): string {
  const list = lists.find((l) => l.id === metric.collectionId);
  const date = list?.dateFields.find((f) => f.key === metric.dateField);
  const parts = [
    list ? list.name : 'A list no longer on this goal',
    list ? (date ? date.label : 'a date no longer in the list') : null,
    metric.period === 'week' ? 'weekly' : 'monthly',
    metric.target !== null ? `aim ${metric.target}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

import { safeTimeZone } from '@/lib/core/timezone';
import type { CollectionField, RecordValues } from '@/lib/goals/collections';
import { periodOf } from '@/lib/goals/rhythms';
import { todayIn } from '@/lib/todo/tasks/model';
import { dayIn } from '@/lib/todo/time';

/**
 * Metrics on a goal (plan #2084.1): what a goal counts over time, such as how
 * many jobs you applied to each week. A metric names one list (a collection),
 * one of its date fields and a period, and the counts are worked out here from
 * the list's records rather than stored (goals.metrics, migration goals 0078).
 *
 * Counting follows the goal's number (migration goals 0028): drafts found for
 * you and archived records are left out, and so is a record with no date in
 * the field. A record is counted in the period its date falls in. The date is
 * a calendar day and needs no zone; the zone decides which day today is and
 * which day the goal was started on.
 */

export const METRIC_PERIODS = ['week', 'month'] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];

/**
 * What a metric counts (plan #2397.1, migration goals 0085): the records of a
 * list, the goal's closed steps, or the files Dash wrote under the goal. Only
 * a list metric has a list and a date field; the others have null in both.
 */
export const METRIC_SOURCES = ['list', 'steps', 'files'] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export type Metric = {
  id: string;
  goalId: string;
  name: string;
  source: MetricSource;
  /** The list counted, for a list metric; null otherwise. */
  collectionId: string | null;
  /** The key of a date field of the list, for a list metric; null otherwise. */
  dateField: string | null;
  period: MetricPeriod;
  /** How many per period you are aiming for, or null. */
  target: number | null;
  position: number;
};

/** What the form saves. */
export type MetricInput = {
  name: string;
  source: MetricSource;
  /** Read only for a list metric. */
  collectionId: string | null;
  /** Read only for a list metric. */
  dateField: string | null;
  period: MetricPeriod;
  target: number | null;
};

/** The highest target a metric takes, as the table's check has it. */
export const MAX_TARGET = 100000;

/** What is wrong with a metric before it is sent, or null. The field is the input's key. */
export function metricInputError(input: MetricInput): { field: keyof MetricInput; error: string } | null {
  const name = input.name.trim();
  if (!name) return { field: 'name', error: 'Give the metric a name.' };
  if (name.length > 200) return { field: 'name', error: 'Keep the name under 200 characters.' };
  if (!METRIC_SOURCES.includes(input.source)) {
    return { field: 'source', error: 'Choose what to count.' };
  }
  if (input.source === 'list') {
    if (!input.collectionId) return { field: 'collectionId', error: 'Choose a list to count.' };
    if (!input.dateField || !/^[a-z][a-z0-9_]{0,39}$/.test(input.dateField)) {
      return { field: 'dateField', error: 'Choose the date to count by.' };
    }
  }
  if (!METRIC_PERIODS.includes(input.period)) {
    return { field: 'period', error: 'Count by week or by month.' };
  }
  if (input.target !== null) {
    if (!Number.isInteger(input.target) || input.target < 1 || input.target > MAX_TARGET) {
      return { field: 'target', error: 'The target is a whole number of at least 1.' };
    }
  }
  return null;
}

/** The live date fields of a list, the ones a metric can count by. */
export function dateFields(fields: CollectionField[]): CollectionField[] {
  return fields.filter((field) => field.type === 'date' && !field.removed);
}

/** A record as the counting reads it: the store's CollectionRecord fits. */
export type CountedRecord = {
  data: RecordValues;
  draft: boolean;
  /** Set when archived. The store loads live records only, so it is usually absent. */
  archivedAt?: string | null;
};

export type PeriodCount = {
  /** The first day of the period: a Monday, or the 1st of a month. */
  startsOn: string;
  /** The day after its last. */
  endsOn: string;
  count: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The record's day in the field, when it is counted at all. */
function countedDay(record: CountedRecord, field: string): string | null {
  if (record.draft || record.archivedAt) return null;
  const value = record.data[field];
  return typeof value === 'string' && DAY.test(value) ? value : null;
}

/**
 * One count per period, oldest first, from the period holding the goal's
 * start (or the earliest counted record, when that is earlier or the start is
 * unknown) to the period holding today, with a zero for each period that has
 * none. A record dated after today's period is not counted, since the chart
 * ends at today. With nothing to start from, there are no periods.
 *
 * `goalStartedAt` is the instant the goal was made (items.created_at); it is
 * read as a day in the account's zone, as is `now`.
 */
export function countByPeriod(options: {
  records: CountedRecord[];
  dateField: string;
  period: MetricPeriod;
  goalStartedAt: string | null;
  now: Date;
  timeZone: string;
}): PeriodCount[] {
  const zone = safeTimeZone(options.timeZone);
  const today = todayIn(zone, options.now);
  const days = options.records
    .map((record) => countedDay(record, options.dateField))
    .filter((day): day is string => day !== null);

  const starts = days.slice();
  if (options.goalStartedAt) starts.push(dayIn(options.goalStartedAt, zone));
  if (starts.length === 0) return [];
  const first = starts.reduce((a, b) => (a < b ? a : b));

  const last = periodOf(options.period, today);
  const periods: PeriodCount[] = [];
  let span = periodOf(options.period, first < today ? first : today);
  while (span.startsOn <= last.startsOn) {
    periods.push({ startsOn: span.startsOn, endsOn: span.endsOn, count: 0 });
    span = periodOf(options.period, span.endsOn);
  }

  const index = new Map(periods.map((p, i) => [p.startsOn, i]));
  for (const day of days) {
    const at = index.get(periodOf(options.period, day).startsOn);
    if (at !== undefined) periods[at].count += 1;
  }
  return periods;
}

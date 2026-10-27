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
 * list, the goal's closed steps, the files Dash wrote under the goal, or the
 * hours logged on it (migration goals 0089). Only a list metric has a list
 * and a date field; the others have null in both.
 */
export const METRIC_SOURCES = ['list', 'steps', 'files', 'hours'] as const;
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
  /** The top of the aim when it is a range, above `target`, or null. */
  targetHigh?: number | null;
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
  /** The top of a range aim; only with a target, and above it. */
  targetHigh?: number | null;
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
  const high = input.targetHigh ?? null;
  if (high !== null) {
    if (input.target === null) return { field: 'targetHigh', error: 'Give the low end of the aim first.' };
    if (!Number.isInteger(high) || high <= input.target || high > MAX_TARGET) {
      return { field: 'targetHigh', error: 'The top of the aim is a whole number above the low end.' };
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
  const { records, dateField, ...rest } = options;
  return countDaysByPeriod({
    ...rest,
    days: records
      .map((record) => countedDay(record, dateField))
      .filter((day): day is string => day !== null),
  });
}

/**
 * countByPeriod over calendar days already picked out, one per thing counted:
 * what the step and file counts below feed it.
 */
export function countDaysByPeriod(options: {
  days: string[];
  period: MetricPeriod;
  goalStartedAt: string | null;
  now: Date;
  timeZone: string;
}): PeriodCount[] {
  const { days, ...rest } = options;
  return sumDaysByPeriod({ ...rest, amounts: days.map((day) => ({ day, amount: 1 })) });
}

/**
 * countDaysByPeriod with an amount on each day in place of one: what an hours
 * metric adds up. A period's `count` is then the sum, which need not be whole.
 */
export function sumDaysByPeriod(options: {
  amounts: { day: string; amount: number }[];
  period: MetricPeriod;
  goalStartedAt: string | null;
  now: Date;
  timeZone: string;
}): PeriodCount[] {
  const zone = safeTimeZone(options.timeZone);
  const today = todayIn(zone, options.now);
  const amounts = options.amounts.filter((a) => DAY.test(a.day) && Number.isFinite(a.amount));
  const days = amounts.map((a) => a.day);

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
  for (const { day, amount } of amounts) {
    const at = index.get(periodOf(options.period, day).startsOn);
    if (at !== undefined) periods[at].count = roundHours(periods[at].count + amount);
  }
  return periods;
}

/** Sums of quarter and tenth hours stay exact to the hundredth, so 0.1 + 0.2 shows as 0.3. */
function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A step under the goal as a steps metric reads it (goals.items). */
export type CountedStep = { status: string; closedAt: string | null };

/** A file linked under the goal as a files metric reads it (core.files). */
export type CountedFile = { id: string; madeBy: string; createdAt: string };

/**
 * The days a steps metric counts (plan #2397.2): each step closed as done, on
 * the day of its closed_at in the account's zone. A dropped step is closed
 * too and is left out, as is one still open.
 */
export function closedStepDays(steps: CountedStep[], timeZone: string): string[] {
  const zone = safeTimeZone(timeZone);
  return steps.flatMap((step) =>
    step.status === 'done' && step.closedAt ? [dayIn(step.closedAt, zone)] : [],
  );
}

/**
 * The days a files metric counts (plan #2397.2): each file Dash wrote, once,
 * on the day it was made in the account's zone. A file linked to the goal and
 * to a step under it is one file, and a new version is the same file, so
 * neither counts again. Files you wrote are left out.
 */
export function dashFileDays(files: CountedFile[], timeZone: string): string[] {
  const zone = safeTimeZone(timeZone);
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (file.madeBy !== 'claude' || seen.has(file.id)) return [];
    seen.add(file.id);
    return [dayIn(file.createdAt, zone)];
  });
}

/** A progress entry as an hours metric reads it (goals.progress_entries). */
export type LoggedEntry = {
  happenedOn: string;
  quantity: number | null;
  unit: string | null;
  /** Set when the entry was taken back; such an entry is not added up. */
  undoneAt?: string | null;
};

const HOUR_UNITS = new Set(['h', 'hr', 'hrs', 'hour', 'hours']);
const MINUTE_UNITS = new Set(['m', 'min', 'mins', 'minute', 'minutes']);

/**
 * The hours an amount stands for, or null when its unit is not time. Capture
 * writes what the sentence said, so "2h", "2 hrs" and "120 minutes" all come
 * to 2.
 */
export function hoursOf(quantity: number | null, unit: string | null): number | null {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0 || !unit) return null;
  const word = unit.trim().toLowerCase().replace(/\.$/, '');
  if (HOUR_UNITS.has(word)) return quantity;
  if (MINUTE_UNITS.has(word)) return quantity / 60;
  return null;
}

/**
 * The days an hours metric adds up (migration goals 0089): each live entry
 * logged in a unit of time, on its own day, in hours.
 */
export function loggedHourDays(entries: LoggedEntry[]): { day: string; amount: number }[] {
  return entries.flatMap((entry) => {
    if (entry.undoneAt) return [];
    const hours = hoursOf(entry.quantity, entry.unit);
    return hours === null ? [] : [{ day: entry.happenedOn, amount: hours }];
  });
}

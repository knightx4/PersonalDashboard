import { whenMonth } from '@/lib/core/when';
import { formatDay } from '@/lib/goals/dates';
import type { MetricPeriod, PeriodCount } from '@/lib/goals/metrics';
import { formatNumber } from '@/lib/money';

/**
 * The numbers behind a metric's bar chart on a goal's Overview (plan
 * #2084.2): the latest periods of its counts, oldest first, each with its
 * share of the scale, and the words drawn around them. Pure, so the chart
 * and its tests agree on what it shows.
 */

/** The most periods drawn: twelve weeks, or twelve months. */
export const METRIC_BARS = 12;

export type MetricBar = PeriodCount & {
  /** The count as a part of the scale's top, 0 to 1. */
  share: number;
  /** The period as a tooltip names it: "Week of 5 Oct", "October 2026". */
  label: string;
};

export type MetricChart = {
  bars: MetricBar[];
  /** The top of the scale: the highest count or the target, whichever is higher. */
  high: number;
  /** The target as a part of the scale's top, or null with no target. */
  targetShare: number | null;
  /** Everything counted in the bars drawn. */
  total: number;
  /** The latest period's count. */
  latest: number;
};

/** A period as the tooltip and the table name it. */
export function periodLabel(period: MetricPeriod, startsOn: string): string {
  if (period === 'week') return `Week of ${formatDay(startsOn)}`;
  return whenMonth(startsOn.slice(0, 7), { timeZone: 'UTC' });
}

/** The first period on the axis: "5 Oct" for a week, "Oct" for a month. */
export function axisLabel(period: MetricPeriod, startsOn: string): string {
  if (period === 'week') return formatDay(startsOn);
  return whenMonth(startsOn.slice(0, 7), { timeZone: 'UTC', month: 'short', year: false });
}

/** "This week", "This month": the latest period, which holds today. */
export function currentLabel(period: MetricPeriod): string {
  return period === 'week' ? 'This week' : 'This month';
}

/**
 * The latest `METRIC_BARS` periods on one scale from zero. A target above
 * every count lifts the scale so its line stays on the chart. Null when
 * there are no periods at all.
 */
export function metricChart(
  counts: readonly PeriodCount[],
  period: MetricPeriod,
  target: number | null,
): MetricChart | null {
  if (counts.length === 0) return null;
  const shown = counts.slice(-METRIC_BARS);
  const most = Math.max(0, ...shown.map((c) => c.count));
  const high = Math.max(1, most, target ?? 0);
  const bars = shown.map((c) => ({
    ...c,
    share: c.count / high,
    label: periodLabel(period, c.startsOn),
  }));
  const total = shown.reduce((sum, c) => sum + c.count, 0);
  return {
    bars,
    high,
    targetShare: target === null ? null : target / high,
    total,
    latest: shown[shown.length - 1].count,
  };
}

/** True when nothing was ever counted: the chart gives way to the empty line. */
export function nothingCounted(counts: readonly PeriodCount[]): boolean {
  return counts.every((c) => c.count === 0);
}

const unit = (period: MetricPeriod, n: number) => `${period}${n === 1 ? '' : 's'}`;

/**
 * The line above the chart: "11 in the last 8 weeks, 2 this week". A chart
 * of one period says only the latest.
 */
export function metricSummary(chart: MetricChart, period: MetricPeriod): string {
  const now = `${formatNumber(chart.latest)} this ${period}`;
  const span = chart.bars.length;
  if (span <= 1) return now;
  return `${formatNumber(chart.total)} in the last ${span} ${unit(period, span)}, ${now}`;
}

/** The target as its line is labelled: "Target 3 a week". */
export function targetLine(target: number, period: MetricPeriod): string {
  return `Target ${formatNumber(target)} a ${period}`;
}

/** One bar as its tooltip and its accessible name read: "Week of 5 Oct: 2". */
export function barLine(bar: MetricBar): string {
  return `${bar.label}: ${formatNumber(bar.count)}`;
}

/** A list as the empty state names it. Collection fits. */
export type MetricList = { id: string; name: string; fields: readonly { key: string; label: string }[] };

/**
 * The list and date field each metric reads, named from the lists given: the
 * list's name and the field's label, or null for one not found.
 */
export function namedLists<M extends { collectionId: string; dateField: string }>(
  metrics: readonly M[],
  lists: readonly MetricList[],
): (M & { list: string | null; field: string | null })[] {
  const byId = new Map(lists.map((list) => [list.id, list]));
  return metrics.map((metric) => {
    const list = byId.get(metric.collectionId);
    const field = list?.fields.find((f) => f.key === metric.dateField);
    return { ...metric, list: list?.name ?? null, field: field?.label ?? null };
  });
}

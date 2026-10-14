import { formatMicroDollars } from '@/lib/money';

/**
 * The numbers behind the per-day bar chart (plan #2036.1): one slot for every
 * day of a period, oldest first, each with its share of the busiest day, so
 * every bar stands on the same scale from zero. Pure, so the chart and its
 * tests agree on what a period holds.
 */

const DAY_MS = 86_400_000;

/** One day's count or amount. `day` is a calendar date, YYYY-MM-DD. */
export type DayValue = { day: string; value: number };

/**
 * What the values are. A count names its thing in the singular and plural
 * ("view", "views"); spend is in micro-dollars, as the spend ledger keeps it.
 * Plain data rather than a formatter, so a server page can pass it.
 */
export type DayMeasure = { kind: 'count'; one: string; many: string } | { kind: 'spend' };

export type DayBar = {
  day: string;
  value: number;
  /** The value as a part of the period's highest, 0 to 1. */
  share: number;
};

export type DayBars = {
  bars: DayBar[];
  total: number;
  /** The highest single day; 0 when nothing happened. */
  high: number;
  /** The first day with the highest value, or null when nothing happened. */
  busiest: DayBar | null;
};

/** The calendar days of a period of `span` days ending on `end`, oldest first. */
export function periodDays(end: string, span: number): string[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  const count = Math.max(1, Math.floor(span));
  return Array.from({ length: count }, (_, index) =>
    new Date(last - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * A slot for every day of the period. A day with no value is a zero slot;
 * two values on one day are added; values outside the period, and anything
 * negative or not a number, are left out.
 */
export function dayBars(values: readonly DayValue[], end: string, span: number): DayBars {
  const days = periodDays(end, span);
  const byDay = new Map<string, number>(days.map((day) => [day, 0]));
  for (const { day, value } of values) {
    if (!byDay.has(day) || !Number.isFinite(value) || value <= 0) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + value);
  }

  const high = Math.max(0, ...byDay.values());
  const bars = days.map((day) => {
    const value = byDay.get(day) ?? 0;
    return { day, value, share: high > 0 ? value / high : 0 };
  });
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const busiest = high > 0 ? (bars.find((bar) => bar.value === high) ?? null) : null;
  return { bars, total, high, busiest };
}

/**
 * A value as the readout names it: "14 views", "1 view", "no views", "$1.20",
 * "nothing spent".
 */
export function formatDayValue(value: number, measure: DayMeasure): string {
  if (measure.kind === 'spend') {
    return value === 0 ? 'nothing spent' : formatMicroDollars(value, { fromCent: true });
  }
  if (value === 0) return `no ${measure.many}`;
  return `${value.toLocaleString('en-US')} ${value === 1 ? measure.one : measure.many}`;
}

/** A value on the scale, with no noun: "41", "$2.40". */
export function formatScale(value: number, measure: DayMeasure): string {
  if (measure.kind === 'spend') return formatMicroDollars(value, { fromCent: true });
  return value.toLocaleString('en-US');
}

/** "in 30 days", "today" for a period of one. */
export function periodPhrase(span: number): string {
  return span <= 1 ? 'today' : `in ${span} days`;
}

/** What the chart says when the period holds nothing. */
export function emptyLine(span: number): string {
  return span <= 1 ? 'Nothing today.' : `Nothing in the last ${span} days.`;
}

/** The reading a screen reader gets in place of the bars. */
export function dayBarsLabel(title: string, chart: DayBars, measure: DayMeasure): string {
  const span = chart.bars.length;
  const total = `${title}: ${formatDayValue(chart.total, measure)} ${periodPhrase(span)}`;
  if (!chart.busiest) return total;
  const active = chart.bars.filter((bar) => bar.value > 0).length;
  return (
    `${total}, on ${active} of ${span} ${span === 1 ? 'day' : 'days'}. ` +
    `Busiest ${chart.busiest.day}, ${formatDayValue(chart.busiest.value, measure)}.`
  );
}

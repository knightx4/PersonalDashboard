import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { todayInTimezone } from '@/lib/money';
import { wallClockToInstant } from '@/lib/todo/time';
import { periodDays, type DayValue } from '@/lib/usage/day-bars';

/**
 * Page views and model spend per day in the person's timezone (plan #2036.2),
 * for the charts on the Usage tab in Dev and the Account Spend page.
 *
 * A period is whole days: today and the days before it, from midnight at the
 * start of the first one. The Usage tab reads its 7- and 30-day figures over
 * the same days (usageWindow), so the bars add up to the figures beneath them.
 * The grouping by day runs in the database (core.page_views_per_day and
 * core.model_spend_per_day, migration 0238), since a month of the spend ledger
 * is more rows than one request returns.
 */

/** Either app client: the request's own, or the core-schema one. */
type Client = SupabaseClient | CoreSupabaseClient;

/** The days a chart covers and where its windows start. */
export type UsageWindow = {
  /** The last day, YYYY-MM-DD in the timezone. */
  today: string;
  /** How many days the period covers, ending today. */
  span: number;
  /** Midnight at the start of the first day of the period, as an ISO instant. */
  since: string;
  /** Midnight at the start of the last seven days, as an ISO instant. */
  since7: string;
};

/** Midnight at the start of `day` in the timezone, as an ISO instant. */
export function startOfLocalDay(day: string, timezone: string): string {
  return wallClockToInstant(day, '00:00', timezone);
}

/** The period of `span` whole days ending today in the timezone. */
export function usageWindow(timezone: string, now: Date = new Date(), span = 30): UsageWindow {
  const today = todayInTimezone(timezone, now);
  const days = periodDays(today, span);
  const week = periodDays(today, Math.min(7, days.length));
  return {
    today,
    span: days.length,
    since: startOfLocalDay(days[0], timezone),
    since7: startOfLocalDay(week[0], timezone),
  };
}

/**
 * One value for every day of the period, oldest first. A day with nothing is
 * a zero; two values on one day are added; a day outside the period is left
 * out.
 */
export function fillDays(values: readonly DayValue[], end: string, span: number): DayValue[] {
  const byDay = new Map<string, number>(periodDays(end, span).map((day) => [day, 0]));
  for (const { day, value } of values) {
    const had = byDay.get(day);
    if (had === undefined || !Number.isFinite(value)) continue;
    byDay.set(day, had + value);
  }
  return [...byDay].map(([day, value]) => ({ day, value }));
}

/** Spend per day over a period, in micro-dollars, with what it leaves out. */
export type SpendDays = {
  /** Every day of the period, zero where nothing priced was spent. */
  values: DayValue[];
  calls: number;
  /** Calls whose model had no published rate: counted here, not in the bars. */
  unpriced: number;
};

type ViewDayRow = { day: string; views: number };
type SpendDayRow = { day: string; spend: number | string; calls: number; unpriced: number };

/** Page views per day over the window, every day present. */
export async function readViewsPerDay(client: Client, timezone: string, window: UsageWindow): Promise<DayValue[]> {
  const { data, error } = await (client as SupabaseClient)
    .schema('core')
    .rpc('page_views_per_day', { p_timezone: timezone, p_since: window.since });
  if (error) throw new Error(`Could not read the page views per day: ${error.message}`);
  const rows = (data ?? []) as ViewDayRow[];
  return fillDays(
    rows.map((row) => ({ day: row.day, value: row.views })),
    window.today,
    window.span,
  );
}

/**
 * Model spend per day over the window, every day present. Unpriced calls add
 * nothing to a day's bar and are counted in `unpriced`, as the function list
 * counts them.
 */
export async function readSpendPerDay(client: Client, timezone: string, window: UsageWindow): Promise<SpendDays> {
  const { data, error } = await (client as SupabaseClient)
    .schema('core')
    .rpc('model_spend_per_day', { p_timezone: timezone, p_since: window.since });
  if (error) throw new Error(`Could not read the spend per day: ${error.message}`);
  const rows = ((data ?? []) as SpendDayRow[]).filter((row) => row.day <= window.today);
  return {
    values: fillDays(
      rows.map((row) => ({ day: row.day, value: Number(row.spend) })),
      window.today,
      window.span,
    ),
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    unpriced: rows.reduce((sum, row) => sum + row.unpriced, 0),
  };
}

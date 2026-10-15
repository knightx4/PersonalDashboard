import { DayBarChart } from '@/components/ui/day-bar-chart';
import type { DayMeasure, DayValue } from '@/lib/usage/day-bars';
import { periodDays } from '@/lib/usage/day-bars';
import { SpendOverview } from '@/app/account/spend/spend-overview';
import { SpendByModule } from '@/app/account/spend/spend-by-module';
import { byModule, type FunctionTotal } from '@/lib/core/spend/summary';
import { spendTotal } from '@/lib/usage/per-day';

/**
 * The per-day bar chart drawn from fixtures for the gallery (plan #2036.1):
 * a month of page views with quiet weekends and a few empty days, a month of
 * model spend with one busy day far above the rest, a month with activity
 * on one day only, and a month with nothing. The readout held on a day and
 * the empty month each have a surface of their own as hidden parts.
 */

const END = '2026-10-13';

const VIEWS: DayMeasure = { kind: 'count', one: 'view', many: 'views' };
const SPEND: DayMeasure = { kind: 'spend' };

function over(counts: readonly number[]): DayValue[] {
  return periodDays(END, counts.length).map((day, index) => ({ day, value: counts[index] }));
}

/** Thirty days of page views: busier midweek, three days with none. */
export const MONTH_VIEWS: DayValue[] = over([
  12, 18, 0, 4, 21, 25, 19, 23, 16, 3, 0, 27, 31, 22, 26, 20, 6, 2, 29, 34, 28, 41, 24, 5, 0, 30,
  26, 33, 22, 14,
]);

/** Thirty days of model spend in micro-dollars, with one big run on the 2nd. */
export const MONTH_SPEND: DayValue[] = over([
  180_000, 240_000, 95_000, 0, 310_000, 120_000, 0, 260_000, 150_000, 4_870_000, 210_000, 175_000,
  90_000, 0, 330_000, 280_000, 140_000, 60_000, 0, 220_000, 300_000, 190_000, 110_000, 45_000, 0,
  250_000, 270_000, 160_000, 130_000, 210_000,
]);

const ONE_DAY: DayValue[] = [{ day: '2026-10-06', value: 7 }];

export function DayBarsSurface() {
  return (
    <div className="space-y-6">
      <DayBarChart title="Page views" values={MONTH_VIEWS} end={END} measure={VIEWS} />
      <DayBarChart title="Model spend" values={MONTH_SPEND} end={END} measure={SPEND} />
      <DayBarChart title="Page views" values={ONE_DAY} end={END} measure={VIEWS} />
      <DayBarChart title="Model spend" values={[]} end={END} measure={SPEND} />
    </div>
  );
}

/** The readout held on a day, as pointing at its bar or tapping it shows it. */
export function DayBarsReadoutSurface() {
  return (
    <div className="space-y-6">
      <DayBarChart
        title="Page views"
        values={MONTH_VIEWS}
        end={END}
        measure={VIEWS}
        heldDay="2026-10-02"
      />
      <DayBarChart
        title="Model spend"
        values={MONTH_SPEND}
        end={END}
        measure={SPEND}
        heldDay="2026-09-27"
      />
    </div>
  );
}

/** A period with nothing in it. */
export function DayBarsEmptySurface() {
  return <DayBarChart title="Page views" values={[]} end={END} measure={VIEWS} />;
}

/**
 * The top of the Account Spend page (plan #2036.3): the month's chart above
 * the thirty-day, month and all-time totals. The thirty-day figure is summed
 * from the bars' own days, as the page does.
 */
export function SpendOverviewSurface() {
  const last30 = spendTotal({ values: MONTH_SPEND, calls: 148, unpriced: 3 });
  return (
    <SpendOverview
      values={MONTH_SPEND}
      today={END}
      span={30}
      last30={last30}
      thisMonth={{ calls: 61, micros: 2_650_000, unpriced: 0 }}
      allTime={{ calls: 2_311, micros: 41_920_000, unpriced: 12 }}
    />
  );
}

const SPEND_FUNCTIONS: FunctionTotal[] = [
  { module: 'jobs', operation: 'score-application', calls: 9_412, micros: 31_204_000, unpriced: 0 },
  { module: 'jobs', operation: 'discover-shortlist', calls: 1_208, micros: 9_870_000, unpriced: 0 },
  { module: 'jobs', operation: 'enrich-company-from-careers-page-and-press', calls: 311, micros: 2_105_000, unpriced: 4 },
  { module: 'learn', operation: 'plan-topic', calls: 88, micros: 6_420_000, unpriced: 0 },
  { module: 'learn', operation: 'lesson', calls: 412, micros: 5_980_000, unpriced: 0 },
  { module: 'core', operation: 'dash-ask', calls: 2_034, micros: 12_440_000, unpriced: 0 },
  { module: 'goals', operation: 'daily', calls: 1, micros: 410_000, unpriced: 0 },
];

/**
 * Where it goes on the Account Spend page (note 7b696ccd): one fold per
 * module with its total on the closed line, the dearest open.
 */
export function SpendByModuleSurface({ open = null }: { open?: string | null }) {
  return <SpendByModule groups={byModule(SPEND_FUNCTIONS)} open={open} />;
}

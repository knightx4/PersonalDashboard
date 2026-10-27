import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import {
  aimText,
  GRID_WEEKS,
  hoursText,
  isWeekend,
  paceText,
  shadeOf,
  type HoursPage,
  type WeekStanding,
} from '@/lib/goals/hours';
import { GoalMetrics, type MetricView } from '../[goalId]/goal-metrics';

/**
 * What the Hours page draws (app/goals/hours/page.tsx), from hoursPage in
 * lib/goals/hours.ts. Four parts, top to bottom: this week against each aim,
 * the last four weeks day by day on one shared shading, a table of how each
 * has gone week by week, and each metric's twelve-week bars as a goal's
 * Overview draws them. Every part uses the accent alone: the rows are told
 * apart by their names, never by a colour.
 */
export function HoursView({ page }: { page: HoursPage }) {
  return (
    <div className="space-y-4">
      <ThisWeek page={page} />
      <DayByDay page={page} />
      <WeekByWeek page={page} />
      <GoalMetrics metrics={trendViews(page)} />
    </div>
  );
}

const PACE_TONE: Record<WeekStanding['pace'], string> = {
  ahead: 'text-positive',
  'on pace': 'text-ink-muted',
  behind: 'text-caution',
  'no aim': 'text-ink-muted',
};

/**
 * One row per metric: the week's hours on a track scaled to the top of the
 * aim, the range as a faint band, and a tick at what the weekday pace expects
 * by today. Then the total of all of them.
 */
function ThisWeek({ page }: { page: HoursPage }) {
  const totalAimLow = page.rows.every((row) => row.metric.target !== null)
    ? page.rows.reduce((sum, row) => sum + (row.metric.target ?? 0), 0)
    : null;
  const totalAimHigh = page.rows.every((row) => row.metric.target !== null)
    ? page.rows.reduce((sum, row) => sum + (row.metric.targetHigh ?? row.metric.target ?? 0), 0)
    : null;
  return (
    <Card padding="standard" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="text-ui font-semibold text-ink">This week</h2>
        <p className="text-small text-ink-muted">Week of {formatDay(page.weekStart)}</p>
      </div>
      <ul className="space-y-4">
        {page.rows.map((row) => (
          <WeekLine
            key={row.metric.id}
            name={row.metric.name}
            href={`/goals/${row.metric.goalId}`}
            goal={row.metric.goalTitle}
            week={row.week}
            target={row.metric.target}
            targetHigh={row.metric.targetHigh}
          />
        ))}
        {page.rows.length > 1 && (
          <WeekLine
            name="All together"
            week={page.total.week}
            target={totalAimLow}
            targetHigh={totalAimHigh !== totalAimLow ? totalAimHigh : null}
            strong
          />
        )}
      </ul>
    </Card>
  );
}

function WeekLine({
  name,
  href,
  goal,
  week,
  target,
  targetHigh,
  strong,
}: {
  name: string;
  href?: string;
  goal?: string;
  week: WeekStanding;
  target: number | null;
  targetHigh: number | null;
  strong?: boolean;
}) {
  const top = Math.max(1, week.hours, targetHigh ?? target ?? 0);
  const pct = (value: number) => `${Math.min(100, (value / top) * 100)}%`;
  const pace = paceText(week);
  const aim = aimText(target, targetHigh);
  return (
    <li className={cn('space-y-1.5', strong && 'border-t border-border pt-4')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="min-w-0 text-ui">
          {href ? (
            <Link href={href} className="font-medium text-ink">
              {name}
            </Link>
          ) : (
            <span className="font-semibold text-ink">{name}</span>
          )}
          {goal && <span className="ml-2 text-small text-ink-muted">{goal}</span>}
        </p>
        <p className="tabular text-small">
          <span className="font-semibold text-ink">{hoursText(week.hours)}</span>
          {aim && <span className="text-ink-muted"> of {aim}</span>}
          {pace && <span className={cn('ml-2', PACE_TONE[week.pace])}>{pace}</span>}
        </p>
      </div>
      <div
        role="img"
        aria-label={[`${name}: ${hoursText(week.hours)} this week`, aim && `aim ${aim}`, pace]
          .filter(Boolean)
          .join(', ')}
        className="relative h-2 overflow-hidden rounded-full bg-sunken"
      >
        {target !== null && targetHigh !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 bg-accent/15"
            style={{ left: pct(target), width: `calc(${pct(targetHigh)} - ${pct(target)})` }}
          />
        )}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: week.hours > 0 ? `max(4px, ${pct(week.hours)})` : 0 }}
        />
        {week.expected !== null && week.expected > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink"
            style={{ left: pct(week.expected) }}
          />
        )}
      </div>
    </li>
  );
}

const SHADES = ['bg-sunken', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent'] as const;
const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * The last four weeks, one cell a day, one row per metric and a row for all
 * of them. Every cell is shaded on the same scale, the most hours on any one
 * day of the grid, so a long day of cleaning and a long day of applying look
 * alike. A day still to come is an outline. Hovering a cell names its day and
 * hours; a table holds the same for a screen reader.
 */
function DayByDay({ page }: { page: HoursPage }) {
  const rows = [
    ...page.rows.map((row) => ({ id: row.metric.id, name: row.metric.name, grid: row.grid })),
    ...(page.rows.length > 1 ? [{ id: 'total', name: 'All', grid: page.total.grid }] : []),
  ];
  const totalHigh = Math.max(page.dayHigh, ...page.total.grid);
  const weeks = Array.from({ length: GRID_WEEKS }, (_, w) => page.gridDays.slice(w * 7, w * 7 + 7));
  return (
    <Card padding="standard" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="text-ui font-semibold text-ink">Day by day</h2>
        <p className="flex items-center gap-1.5 text-small text-ink-muted">
          <span>0 h</span>
          {SHADES.map((shade) => (
            <span key={shade} aria-hidden className={cn('size-2.5 rounded-[2px]', shade)} /* ui-ok: a key to the day cells' shades, drawn as the cells are */ />
          ))}
          <span className="tabular">{hoursText(page.dayHigh)}</span>
        </p>
      </div>
      <div aria-hidden className="grid max-w-2xl grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <span />
        <div className="grid grid-cols-4 gap-1.5">
          {weeks.map((days) => (
            <div key={days[0]} className="space-y-1">
              <p className="tabular truncate text-small text-ink-muted">{formatDay(days[0])}</p>
              <div className="grid grid-cols-7 gap-[2px]">
                {days.map((day, i) => (
                  <span
                    key={day}
                    className={cn(
                      'text-center text-micro leading-none text-ink-muted',
                      isWeekend(day) && 'opacity-60',
                    )}
                  >
                    {WEEKDAY[i]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <DayRow
            key={row.id}
            name={row.name}
            grid={row.grid}
            days={page.gridDays}
            today={page.today}
            // The total row has its own scale, since its days add the others up.
            high={row.id === 'total' ? totalHigh : page.dayHigh}
            strong={row.id === 'total'}
          />
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>Hours logged each day of the last {GRID_WEEKS} weeks</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {rows.map((row) => (
                <th key={row.id} scope="col">
                  {row.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.gridDays
              .filter((day) => day <= page.today)
              .map((day, i) => (
                <tr key={day}>
                  <th scope="row">{formatDay(day)}</th>
                  {rows.map((row) => (
                    <td key={row.id}>{hoursText(row.grid[i])}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DayRow({
  name,
  grid,
  days,
  today,
  high,
  strong,
}: {
  name: string;
  grid: number[];
  days: string[];
  today: string;
  high: number;
  strong?: boolean;
}) {
  return (
    <>
      <span className={cn('truncate self-center text-small', strong ? 'font-semibold text-ink' : 'text-ink')}>
        {name}
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: GRID_WEEKS }, (_, w) => (
          <div key={w} className="grid grid-cols-7 gap-[2px]">
            {days.slice(w * 7, w * 7 + 7).map((day, i) => {
              const hours = grid[w * 7 + i];
              if (day > today) {
                return <span key={day} className="aspect-square rounded-[2px] border border-border" /* ui-ok: a day still to come, a chart mark */ />;
              }
              return (
                <Tooltip
                  key={day}
                  label={`${formatDay(day)}: ${hoursText(hours)}`}
                  align={w >= GRID_WEEKS / 2 ? 'end' : 'start'}
                  className="flex min-w-0"
                >
                  <span
                    className={cn(
                      'block aspect-square w-full rounded-[2px]', // ui-ok: a day's cell is a chart mark, too small for the control radius
                      SHADES[shadeOf(hours, high)],
                      day === today && 'outline outline-1 outline-offset-0 outline-ink',
                    )}
                  />
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** "3 of 8", or a dash with no aim. */
const ofEight = (value: number | null) => (value === null ? '–' : `${value}/8`);

/**
 * How each metric has gone over the full weeks before this one: its average
 * per weekday over the last four, last week's total, its best week of the
 * twelve, how many of the last eight reached the aim, and how many weeks in a
 * row up to last week did.
 */
function WeekByWeek({ page }: { page: HoursPage }) {
  return (
    <Card padding="standard" className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-ui font-semibold text-ink">Week by week</h2>
        <p className="text-small text-ink-muted">
          The full weeks before this one: hours per weekday over the last four, the best of twelve,
          how many of the last eight reached the aim, and how many in a row up to last week.
        </p>
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="tabular w-full min-w-[22rem] whitespace-nowrap text-small">
          <thead>
            <tr className="text-left text-ink-muted">
              <th scope="col" className="py-1 pr-3 font-medium">
                <span className="sr-only">Metric</span>
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Per weekday</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Last week</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Best</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">On aim</th>
              <th scope="col" className="py-1 text-right font-medium">Streak</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => {
              const lastWeek = row.weeks[row.weeks.length - 2]?.hours ?? 0;
              return (
                <tr key={row.metric.id} className="border-t border-border text-ink">
                  <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-medium">
                    {row.metric.name}
                  </th>
                  <td className="py-1.5 pr-3 text-right">{hoursText(row.perWeekday)}</td>
                  <td className="py-1.5 pr-3 text-right">{hoursText(lastWeek)}</td>
                  <td className="py-1.5 pr-3 text-right">{hoursText(row.best)}</td>
                  <td className="py-1.5 pr-3 text-right">{ofEight(row.weeksOnAim)}</td>
                  <td className="py-1.5 text-right">{row.streak === null ? '–' : row.streak}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Each metric's twelve weeks as the Overview's chart reads them. */
function trendViews(page: HoursPage): MetricView[] {
  return page.rows.map((row) => ({
    id: row.metric.id,
    name: `${row.metric.name}, week by week`,
    period: 'week',
    target: row.metric.target,
    targetHigh: row.metric.targetHigh,
    source: 'hours',
    list: null,
    field: null,
    counts: row.weeks.map((week, i) => ({
      startsOn: week.startsOn,
      endsOn: row.weeks[i + 1]?.startsOn ?? '',
      count: week.hours,
    })),
  }));
}

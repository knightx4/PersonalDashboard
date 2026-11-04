'use client';

import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import { GRID_WEEKS, hoursText, shadeOf, type HoursPage } from '@/lib/goals/hours';
import { loadHoursDay } from './actions';
import { DayDrawer, type DayState } from './day-drawer';

const SHADES = ['bg-sunken', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent'] as const;
const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** A day drawn open, for the gallery: the day and what its read returned. */
export type OpenDay = { day: string; state: DayState; logOpen?: boolean; contained?: boolean };

/**
 * The last four weeks, one cell a day, one row per metric and a row for all
 * of them. Every cell is shaded on the same scale, the most hours on any one
 * day of the grid, so a long day of cleaning and a long day of applying look
 * alike. A day still to come is an outline. Hovering a cell names its day and
 * hours; a table holds the same for a screen reader.
 *
 * Tapping a day, on any row, opens that day's entries in a drawer (plan
 * #2907.2), read each time it opens.
 */
export function DayByDay({
  page,
  earliest,
  initialOpen,
}: {
  page: HoursPage;
  /** The earliest day Log hours offers, for the empty day's box. */
  earliest: string;
  /** Drawn with a day open, for the gallery. */
  initialOpen?: OpenDay;
}) {
  const [open, setOpen] = useState<OpenDay | null>(initialOpen ?? null);

  const read = useCallback((day: string) => {
    setOpen({ day, state: { status: 'loading' } });
    loadHoursDay(day)
      .catch(() => ({ entries: [], error: 'The hours for this day could not be read.' }))
      .then((result) => {
        setOpen((current) =>
          current?.day !== day
            ? current
            : {
                day,
                state: result.error
                  ? { status: 'error', message: result.error }
                  : { status: 'ready', entries: result.entries },
              },
        );
      });
  }, []);
  const close = useCallback(() => setOpen(null), []);

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
            <span key={shade} aria-hidden className={cn('size-2.5', shade)} />
          ))}
          <span className="tabular">{hoursText(page.dayHigh)}</span>
        </p>
      </div>
      <div className="grid max-w-2xl grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <span aria-hidden />
        <div aria-hidden className="grid grid-cols-4 gap-1.5">
          {weeks.map((days) => (
            <div key={days[0]} className="space-y-1">
              <p className="tabular truncate text-small text-ink-muted">{formatDay(days[0])}</p>
              <div className="grid grid-cols-7 gap-[2px]">
                {days.map((day, i) => (
                  <span
                    key={day}
                    className="text-center text-micro leading-none text-ink-muted"
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
            onOpen={read}
            opened={open?.day ?? null}
          />
        ))}
      </div>
      <p className="text-small text-ink-muted">Tap a day to see what was logged.</p>
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
      {open && (
        <DayDrawer
          day={open.day}
          today={page.today}
          earliest={earliest}
          state={open.state}
          logOpen={open.logOpen}
          contained={open.contained}
          onRetry={() => read(open.day)}
          onClose={close}
        />
      )}
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
  onOpen,
  opened,
}: {
  name: string;
  grid: number[];
  days: string[];
  today: string;
  high: number;
  strong?: boolean;
  onOpen: (day: string) => void;
  /** The day whose drawer is open, ringed so the grid says which it is. */
  opened: string | null;
}) {
  return (
    <>
      <span
        aria-hidden
        className={cn('truncate self-center text-small', strong ? 'font-semibold text-ink' : 'text-ink')}
      >
        {name}
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: GRID_WEEKS }, (_, w) => (
          <div key={w} className="grid grid-cols-7 gap-[2px]">
            {days.slice(w * 7, w * 7 + 7).map((day, i) => {
              const hours = grid[w * 7 + i];
              if (day > today) {
                return <span key={day} aria-hidden className="aspect-square border border-border" /* ui-ok: a day still to come, a chart mark */ />;
              }
              const label = `${formatDay(day)}: ${hoursText(hours)}`;
              return (
                <Tooltip
                  key={day}
                  label={label}
                  align={w >= GRID_WEEKS / 2 ? 'end' : 'start'}
                  className="flex min-w-0"
                >
                  <button
                    type="button"
                    aria-label={`${name}, ${label}. Open the day`}
                    onClick={() => onOpen(day)}
                    className={cn(
                      'block aspect-square w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                      SHADES[shadeOf(hours, high)],
                      day === today && 'outline outline-1 outline-offset-0 outline-ink',
                      day === opened && 'outline outline-2 outline-offset-1 outline-accent',
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

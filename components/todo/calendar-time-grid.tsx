import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/todo/calendar-month';
import { blocksFor, hourIn, hourWindow, hoursOf } from '@/lib/todo/calendar/range';
import type { CalendarDay } from '@/lib/todo/calendar/month';

/**
 * A day or a week, on the clock.
 *
 * The shape everyone means by "calendar": the days across the top, the hours
 * down the side, and a thing sitting where its hour crosses its day. A server
 * component with no state, like the month grid beside it -- paging and the
 * choice of view are links.
 *
 * An event has a duration, so it is drawn over the hours it runs: a tinted
 * block behind the grid, from its first hour row to its last. Nothing else
 * here has one. A task due at 14:00, a return deadline, an interview whose end
 * nobody recorded -- those stay a line in their hour, because drawing a box
 * around an instant would be the calendar inventing a fact, and the one thing
 * this page cannot do is disagree with the list about when something is.
 *
 * The hours are one grid rather than a grid per hour, which is what lets a
 * block span rows and still line up with every column beside it.
 */

const HOUR_LABEL = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export function CalendarTimeGrid({
  days,
  timezone,
}: {
  days: CalendarDay[];
  timezone: string;
}) {
  const hours = hoursOf(hourWindow(days, timezone));

  // The columns: an hour gutter, then one per day. Inline because the count is
  // data -- one column for a day, seven for a week.
  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };

  // A week of seven readable columns does not fit a phone, so it scrolls
  // sideways rather than shrinking into seven illegible ones. A single day has
  // nothing to scroll.
  const frame = days.length > 1 ? { minWidth: `${3.5 + days.length * 5.5}rem` } : undefined;

  const allDay = days.map((day) => day.entries.filter((entry) => !entry.at));
  const hasAllDay = allDay.some((entries) => entries.length > 0);

  return (
    <Card padding="none" className="mt-4 overflow-hidden">
      <div className="overflow-x-auto">
        <div style={frame}>
          <div className="grid border-b border-border" style={columns}>
            <span />
            {days.map((day) => (
              <DayHeading key={day.day} day={day} />
            ))}
          </div>

          {/* What happens on a day without happening at a time. Above the
              hours, because that is where it is on every calendar anyone has
              used, and because a due date with no clock is the common case
              here rather than the exception. */}
          {hasAllDay && (
            <div className="grid border-b border-border bg-canvas" style={columns}>
              <span className="px-2 py-1.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">
                All day
              </span>
              {days.map((day, index) => (
                <div
                  key={day.day}
                  className="min-w-0 space-y-0.5 border-l border-border p-1.5"
                >
                  {allDay[index].map((entry) => (
                    <Pill key={entry.key} entry={entry} timezone={timezone} />
                  ))}
                </div>
              ))}
            </div>
          )}

          <div
            className="grid"
            style={{
              ...columns,
              gridTemplateRows: `repeat(${hours.length}, minmax(2.25rem, auto))`,
            }}
          >
            {hours.map((hour, row) => (
              <span
                key={`label-${hour}`}
                style={{ gridRow: row + 1, gridColumn: 1 }}
                className="tabular px-2 py-1.5 text-right text-small text-ink-ghost"
              >
                {HOUR_LABEL(hour)}
              </span>
            ))}

            {/* The blocks go in before the cells and are not positioned, so
                the cells paint over them and a task due inside a meeting stays
                readable on top of it. No z-index: the painting order is the
                DOM order, and a rung on the ladder would be claiming this is
                a layer of the app rather than two lines of one grid.

                A block carries no text. The title is the pill in the hour the
                event starts, which is already in the entries -- the block is
                the extent. */}
            {days.flatMap((day, column) =>
              blocksFor(day.entries, timezone).map((block) => {
                const from = hours.indexOf(block.from);
                const to = hours.indexOf(block.to);
                if (from === -1 || to === -1) return null;

                return (
                  <div
                    key={`block-${day.day}-${block.entry.key}`}
                    aria-hidden
                    style={{
                      gridRow: `${from + 1} / ${to + 2}`,
                      gridColumn: column + 2,
                      marginLeft: `${(block.lane / block.lanes) * 100}%`,
                      width: `${(1 / block.lanes) * 100}%`,
                    }}
                    className="pointer-events-none my-px rounded-md border-l-2 border-accent bg-accent-tint"
                  />
                );
              }),
            )}

            {hours.map((hour, row) =>
              days.map((day, column) => (
                <div
                  key={`${day.day}-${hour}`}
                  style={{ gridRow: row + 1, gridColumn: column + 2 }}
                  className={cn(
                    'relative min-w-0 space-y-0.5 border-l border-border p-1.5',
                    row < hours.length - 1 && 'border-b',
                    day.isToday && 'bg-accent-tint/30',
                  )}
                >
                  {day.entries
                    .filter((entry) => entry.at && hourIn(entry.at, timezone) === hour)
                    .map((entry) => (
                      <Pill key={entry.key} entry={entry} timezone={timezone} />
                    ))}
                </div>
              )),
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The day across the top: its name, its number, and the way to it on its own. */
function DayHeading({ day }: { day: CalendarDay }) {
  const date = new Date(`${day.day}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(
    date,
  );

  return (
    <Link
      href={{ pathname: '/todo/calendar', query: { view: 'day', date: day.day } }}
      className="flex min-w-0 items-baseline gap-1.5 border-l border-border px-2 py-1.5 transition-colors duration-150 hover:bg-sunken"
    >
      <span className="truncate text-micro font-semibold uppercase tracking-wide text-ink-muted">
        {weekday}
      </span>
      <span
        className={cn(
          'tabular text-ui',
          day.isToday
            ? 'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-surface'
            : 'text-ink',
        )}
      >
        {Number(day.day.slice(8))}
      </span>
    </Link>
  );
}

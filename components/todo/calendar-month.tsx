import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { CalendarDay, CalendarEntry } from '@/lib/todo/calendar/month';

/**
 * A month, drawn.
 *
 * A server component with no state of its own: paging is a link, and every
 * square is already decided by lib/todo/calendar/month.ts. Nothing here can
 * disagree with the agenda about which day a thing falls on, because neither
 * page works that out for itself.
 *
 * On a narrow screen the grid becomes a list of the days that actually hold
 * something. Seven columns on a phone is six illegible ones and a scrollbar,
 * and an empty Tuesday is worth a square only when there is room to see it.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarMonthGrid({
  weeks,
  timezone,
}: {
  weeks: CalendarDay[][];
  timezone: string;
}) {
  const busy = weeks.flat().filter((day) => day.entries.length > 0);

  return (
    <>
      <div className="mt-4 hidden overflow-hidden rounded-card border border-border bg-surface sm:block">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((label) => (
            <div key={label} className="px-2 py-1.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {weeks.flat().map((day) => (
            <div
              key={day.day}
              className={cn(
                'min-h-24 border-b border-r border-border p-1.5 last:border-r-0',
                !day.inMonth && 'bg-canvas',
              )}
            >
              <div
                className={cn(
                  'tabular text-small',
                  day.isToday
                    ? 'inline-flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-surface'
                    : day.inMonth
                      ? 'text-ink-muted'
                      : 'text-ink-ghost',
                )}
              >
                {Number(day.day.slice(8))}
              </div>

              <ul className="mt-1 space-y-0.5">
                {day.entries.map((entry) => (
                  <li key={entry.key}>
                    <Pill entry={entry} timezone={timezone} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* The phone view: the days that hold something, in order. */}
      <div className="mt-4 space-y-3 sm:hidden">
        {busy.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-6 text-center text-ui text-ink-muted">
            Nothing this month.
          </p>
        ) : (
          busy.map((day) => (
            <div key={day.day} className="rounded-card border border-border bg-surface p-3">
              <p
                className={cn(
                  'text-ui font-semibold',
                  day.isToday ? 'text-accent' : day.inMonth ? 'text-ink' : 'text-ink-muted',
                )}
              >
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'UTC',
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                }).format(new Date(`${day.day}T00:00:00Z`))}
              </p>
              <ul className="mt-1.5 space-y-1">
                {day.entries.map((entry) => (
                  <li key={entry.key}>
                    <Pill entry={entry} timezone={timezone} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/**
 * One thing in a square.
 *
 * Coloured by where it came from rather than by how urgent it is: urgency is
 * the agenda's job, and a month painted red for every overdue task would say
 * nothing about the month.
 */
export function Pill({ entry, timezone }: { entry: CalendarEntry; timezone: string }) {
  const time = entry.at
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(entry.at))
    : null;

  const body = (
    <span
      className={cn(
        'flex items-baseline gap-1 truncate rounded px-1 py-0.5 text-small leading-tight',
        entry.kind === 'context' && 'bg-accent-tint text-ink',
        entry.kind === 'item' && 'bg-canvas text-ink',
        entry.kind === 'task' && 'text-ink',
        entry.done && 'text-ink-muted line-through',
      )}
    >
      {time && <span className="tabular shrink-0 text-micro text-ink-muted">{time}</span>}
      <span className="truncate">{entry.title}</span>
    </span>
  );

  if (!entry.href) return body;

  return (
    <Link href={entry.href} className="block hover:text-accent" title={entry.title}>
      {body}
    </Link>
  );
}

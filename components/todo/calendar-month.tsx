import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import type { CalendarDay, CalendarEntry } from '@/lib/todo/calendar/month';

/**
 * A month, drawn.
 *
 * A server component with no state of its own: paging, the choice of view and
 * opening a day are all links, and every square is already decided by
 * lib/todo/calendar/month.ts. Nothing here can disagree with the agenda about
 * which day a thing falls on, because neither page works that out for itself.
 *
 * Seven columns on a phone too. It used to fall back to a list of the days
 * that held something, which is a perfectly good list and not a calendar --
 * and the empty Thursday, which is most of what a month is read for, was the
 * thing the list could not show. The squares stay; what does not fit inside
 * one at that width is the writing, so a phone gets a dot per thing and the
 * day number opens the day.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** More dots than this in one square and they stop being countable anyway. */
const MAX_DOTS = 4;

export function CalendarMonthGrid({
  days,
  timezone,
  newEventHref,
}: {
  days: CalendarDay[];
  timezone: string;
  /** Where the square's add control goes. */
  newEventHref: (day: string) => string;
}) {
  return (
    <Card padding="none" className="mt-4 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="truncate px-1.5 py-1.5 text-micro font-semibold uppercase tracking-wide text-ink-muted sm:px-2"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => (
          <div
            key={day.day}
            className={cn(
              'group relative min-h-16 border-b border-r border-border p-1 last:border-r-0 sm:min-h-24 sm:p-1.5',
              !day.inMonth && 'bg-canvas',
            )}
          >
            {/* Adding to a square you are already looking at, without going
                anywhere first. Not drawn on a phone: the squares are a fifth
                of the width there and the day number is the way in. */}
            <Link
              href={newEventHref(day.day)}
              aria-label={`New event on ${day.day}`}
              title="New event"
              className="press absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full text-ink-ghost opacity-0 transition-opacity duration-150 hover:bg-accent-tint hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 sm:flex"
            >
              <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
            </Link>

            {/* The number is the way into the day, at every width: a square
                that cannot hold everything in it has to lead somewhere that
                can. */}
            <Link
              href={{ pathname: '/todo/calendar', query: { view: 'day', date: day.day } }}
              className={cn(
                'tabular inline-flex size-5 items-center justify-center rounded-full text-small transition-colors duration-150',
                day.isToday
                  ? 'bg-accent font-semibold text-surface'
                  : day.inMonth
                    ? 'text-ink-muted hover:bg-sunken hover:text-ink'
                    : 'text-ink-ghost hover:bg-sunken',
              )}
            >
              {Number(day.day.slice(8))}
            </Link>

            {/* A dot each, below sm. */}
            {day.entries.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-0.5 sm:hidden" aria-hidden>
                {day.entries.slice(0, MAX_DOTS).map((entry) => (
                  <span
                    key={entry.key}
                    className={cn(
                      'size-1.5 rounded-full',
                      entry.done ? 'bg-ink-ghost' : DOT[entry.kind],
                    )}
                  />
                ))}
                {day.entries.length > MAX_DOTS && (
                  <span className="tabular text-micro leading-none text-ink-muted">
                    +{day.entries.length - MAX_DOTS}
                  </span>
                )}
              </div>
            )}
            <span className="sr-only sm:hidden">
              {day.entries.length > 0 &&
                `${day.entries.length} thing${day.entries.length === 1 ? '' : 's'}`}
            </span>

            <ul className="mt-1 hidden space-y-0.5 sm:block">
              {day.entries.map((entry) => (
                <li key={entry.key}>
                  <Pill entry={entry} timezone={timezone} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

const DOT: Record<CalendarEntry['kind'], string> = {
  event: 'bg-ink',
  task: 'bg-ink-muted',
  item: 'bg-accent',
  context: 'bg-positive',
};

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
        entry.kind === 'event' && 'bg-accent-tint font-medium text-ink',
        entry.kind === 'context' && 'bg-accent-tint text-ink',
        entry.kind === 'item' && 'bg-canvas text-ink',
        entry.kind === 'task' && 'text-ink',
        entry.done && 'text-ink-muted line-through',
      )}
    >
      {time && <span className="tabular shrink-0 text-small text-ink-muted">{time}</span>}
      <span className="truncate">{entry.title}</span>
    </span>
  );

  if (!entry.href) return body;

  return (
    <Link
      href={entry.href}
      className="block transition-colors duration-150 hover:text-accent"
      title={entry.title}
    >
      {body}
    </Link>
  );
}

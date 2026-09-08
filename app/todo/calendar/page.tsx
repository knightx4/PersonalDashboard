import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { loadCalendar } from '@/lib/todo/calendar/load';
import { isMonth } from '@/lib/todo/calendar/month';
import {
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABEL,
  isCalendarView,
  isDay,
  shiftAnchor,
  type CalendarView,
} from '@/lib/todo/calendar/range';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarMonthGrid, Pill } from '@/components/todo/calendar-month';
import { CalendarTimeGrid } from '@/components/todo/calendar-time-grid';

export const metadata = { title: 'Calendar' };

/**
 * The calendar: a day, a week or a month of it.
 *
 * The agenda answers "what needs me next" and deliberately shows nothing for a
 * quiet day. That is the right answer to its question and the wrong one to
 * this: the reason to open a calendar is usually the empty Thursday, not the
 * full one.
 *
 * Which view and which day are in the URL, so a week can be linked to and the
 * back button pages back through the ones you looked at. No client state at
 * all -- paging, the view and opening a day are links.
 */
export default async function TodoCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; month?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const view: CalendarView =
    params.view && isCalendarView(params.view) ? params.view : 'month';

  // `month=YYYY-MM` is what this page took before it had views, and links to
  // it are out in the world -- in the browser's history at the very least.
  const anchor =
    params.date && isDay(params.date)
      ? params.date
      : params.month && isMonth(params.month)
        ? `${params.month}-01`
        : undefined;

  const calendar = await loadCalendar(user.id, view, anchor);
  const nothing = calendar.days.every((day) => day.entries.length === 0);

  return (
    // No width of its own: a calendar is a grid, and seven columns want every
    // bit of the shell's 1400. The other todo pages are reading columns.
    <div>
      <PageHeader title="Calendar" description="Everything with a date on it, laid out." />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-body font-semibold text-ink">{title(calendar.view, calendar.days)}</h2>

        <nav className="flex items-center gap-1" aria-label={`Change ${calendar.view}`}>
          <StepLink
            view={calendar.view}
            date={shiftAnchor(calendar.view, calendar.anchor, -1)}
            label={`Previous ${calendar.view}`}
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </StepLink>
          <Link
            href={{ pathname: '/todo/calendar', query: { view: calendar.view } }}
            className="rounded-lg px-3 py-1.5 text-ui font-medium text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            Today
          </Link>
          <StepLink
            view={calendar.view}
            date={shiftAnchor(calendar.view, calendar.anchor, 1)}
            label={`Next ${calendar.view}`}
          >
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          </StepLink>
        </nav>

        {/* Day, week, month -- keeping the day you were looking at, so
            switching view does not also move you in time. */}
        <nav aria-label="View" className="ml-auto flex items-center gap-1">
          {CALENDAR_VIEWS.map((candidate) => (
            <Link
              key={candidate}
              href={{
                pathname: '/todo/calendar',
                query: { view: candidate, date: calendar.anchor },
              }}
              aria-current={candidate === calendar.view ? 'page' : undefined}
              className={cn(
                'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-150',
                candidate === calendar.view
                  ? 'bg-accent text-surface'
                  : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
              )}
            >
              {CALENDAR_VIEW_LABEL[candidate]}
            </Link>
          ))}
        </nav>
      </div>

      {/* Same rule as the agenda: a source that failed is said out loud, because
          a silently shorter month looks exactly like a quiet one. */}
      {calendar.failed.length > 0 && (
        <Banner tone="bad" className="mt-4">
          {calendar.failed.join(' and ')} could not be read just now, so anything from{' '}
          {calendar.failed.length > 1 ? 'them' : 'it'} is missing from this {calendar.view}.
        </Banner>
      )}

      {calendar.view === 'month' ? (
        <CalendarMonthGrid days={calendar.days} timezone={calendar.timezone} />
      ) : (
        <CalendarTimeGrid days={calendar.days} timezone={calendar.timezone} />
      )}

      {/* A day or a week with nothing in it is a grid of empty hours, which
          says "nothing here" clearly enough on its own but not what to do
          about it. */}
      {nothing && calendar.view !== 'month' && (
        <EmptyState
          className="mt-4"
          icon={CalendarDays}
          title={`Nothing this ${calendar.view}`}
          description="Anything with a date on it lands on its hour here."
          action={{ label: 'Add a task', href: '/todo' }}
        />
      )}

      {/* Tasks with no due date belong to no square. Naming them is what keeps
          the calendar from holding quietly fewer tasks than the list does. */}
      {calendar.undated.length > 0 && (
        <section className="mt-6">
          <h2 className="text-ui font-semibold text-ink">
            No date
            <span className="tabular ml-2 text-small font-normal text-ink-muted">
              {calendar.undated.length}
            </span>
          </h2>
          <ul className={cn(cardVariants({ padding: 'dense' }), 'mt-1 space-y-1')}>
            {calendar.undated.map((entry) => (
              <li key={entry.key}>
                <Pill entry={entry} timezone={calendar.timezone} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * What you are looking at, said the way a person would say it.
 *
 * A week gets its two ends, and only says the month or the year once when both
 * ends share one -- "31 August – 6 September 2026" rather than a date printed
 * twice in full.
 */
function title(view: CalendarView, days: readonly { day: string }[]): string {
  const at = (day: string) => new Date(`${day}T00:00:00Z`);
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(at(day));

  if (view === 'day') {
    return format(days[0].day, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  if (view === 'month') {
    // The middle of the six weeks is always in the month itself; the ends are
    // not.
    return format(days[21].day, { month: 'long', year: 'numeric' });
  }

  const first = days[0].day;
  const last = days[days.length - 1].day;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);

  const from = format(first, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'long' }),
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const to = format(last, { day: 'numeric', month: 'long', year: 'numeric' });

  return `${from} – ${to}`;
}

function StepLink({
  view,
  date,
  label,
  children,
}: {
  view: CalendarView;
  date: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={{ pathname: '/todo/calendar', query: { view, date } }}
      aria-label={label}
      title={label}
      className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
    >
      {children}
    </Link>
  );
}

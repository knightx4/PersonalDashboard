import Link from 'next/link';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { loadCalendar } from '@/lib/todo/calendar/load';
import { addMonths, isMonth } from '@/lib/todo/calendar/month';
import { PageHeader } from '@/components/shell/page-header';
import { CalendarMonthGrid, Pill } from '@/components/todo/calendar-month';

export const metadata = { title: 'Calendar' };

/**
 * The month, laid out.
 *
 * The agenda answers "what needs me next" and deliberately shows nothing for a
 * quiet day. That is the right answer to its question and the wrong one to
 * this: the reason to open a calendar is usually the empty Thursday, not the
 * full one.
 *
 * Which month is in the URL, so a month can be linked to and the back button
 * pages back through the ones you looked at. No client state at all.
 */
export default async function TodoCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const requested = params.month && isMonth(params.month) ? params.month : undefined;
  const calendar = await loadCalendar(user.id, requested);

  const title = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${calendar.month}-01T00:00:00Z`));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Calendar" description="Everything with a date on it, month by month." />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold text-ink">{title}</h2>

        <nav className="ml-auto flex items-center gap-1" aria-label="Change month">
          <MonthLink month={addMonths(calendar.month, -1)} label="Previous month">
            <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </MonthLink>
          <Link
            href="/todo/calendar"
            className="rounded-lg px-3 py-1.5 text-ui font-medium text-ink-muted hover:bg-canvas hover:text-ink"
          >
            Today
          </Link>
          <MonthLink month={addMonths(calendar.month, 1)} label="Next month">
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          </MonthLink>
        </nav>
      </div>

      {/* Same rule as the agenda: a source that failed is said out loud, because
          a silently shorter month looks exactly like a quiet one. */}
      {calendar.failed.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-caution-tint px-3 py-2 text-ui text-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            {calendar.failed.join(' and ')} could not be read just now, so anything from{' '}
            {calendar.failed.length > 1 ? 'them' : 'it'} is missing from this month.
          </span>
        </p>
      )}

      <CalendarMonthGrid weeks={calendar.weeks} timezone={calendar.timezone} />

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
          <ul className="mt-1 space-y-1 rounded-card border border-border bg-surface p-3">
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

function MonthLink({
  month,
  label,
  children,
}: {
  month: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={{ pathname: '/todo/calendar', query: { month } }}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink"
    >
      {children}
    </Link>
  );
}

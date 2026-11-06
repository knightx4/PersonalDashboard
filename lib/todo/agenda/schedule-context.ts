import type { DayContext } from '@/lib/todo/agenda/sources';
import type { ScheduleEntry } from '@/lib/todo/schedule/model';
import { whenDate, whenTime } from '@/lib/core/when';

/**
 * The one schedule's booked entries (lib/todo/schedule, plan #3027), as the
 * day context the agenda draws (plan #3027.1).
 *
 * The agenda used to read events, subscribed calendars, booking emails and
 * interviews each on its own, the last two only when their switch was on, so
 * a dinner on a calendar and in a confirmation email showed twice and an
 * appointment vanished with its switch. The schedule has already folded the
 * copies, so each thing is one row here, naming where else it is.
 *
 * Due entries are left out: the agenda lists todos and reminders as rows to
 * act on, from its own reads.
 *
 * PURE, like events.ts beside it, whose rules for a span it keeps: an entry
 * that began before today shows on today, once, and its clock only on the
 * day it starts.
 */
export function scheduleContext(
  entries: readonly ScheduleEntry[],
  timezone: string,
  today: string,
): DayContext[] {
  const context: DayContext[] = [];

  for (const entry of entries) {
    if (entry.kind !== 'booked' || entry.lastDay < today) continue;

    const day = entry.day < today ? today : entry.day;
    const parts = [entry.detail, entry.location].filter((part): part is string => Boolean(part));
    if (entry.lastDay !== entry.day) parts.push(`until ${dayLabel(entry.lastDay)}`);

    context.push({
      key: entry.key,
      ref: entry.ref,
      day,
      at: entry.startsAt && day === entry.day ? entry.startsAt : null,
      label: entry.title,
      detail: parts.length > 0 ? parts.join(' · ') : null,
      link: { href: entry.href, label: entry.href.startsWith('/jobs/roles/') ? 'Prep' : 'Open' },
      alsoIn: [...new Set(entry.alsoIn.map((copy) => copy.from))].filter((from) => from !== entry.from),
      question: rowQuestion(entry, timezone),
    });
  }

  return context;
}

/**
 * The conflict as a row asks it: only the other copies, since the row
 * already gives the title and its own time. "Google calendar says 11:00 AM.
 * Which is right?" The morning brief, which has no row, asks the long form
 * (conflictQuestion in lib/todo/schedule/model.ts).
 */
export function rowQuestion(entry: ScheduleEntry, timezone: string): string | null {
  if (entry.conflicts.length === 0) return null;
  const others = entry.conflicts
    .map((copy) => `${copy.from} says ${copy.startsAt ? whenTime(copy.startsAt, { timeZone: timezone }) : 'no time'}`)
    .join(', and ');
  return `${others}. Which is right?`;
}

/** A calendar day as words, read in UTC because the day is already the reader's. */
function dayLabel(day: string): string {
  return whenDate(day, { timeZone: 'UTC', weekday: 'short', year: 'never' });
}

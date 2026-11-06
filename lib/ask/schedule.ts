import { parseRef } from '@/lib/core/refs';
import { whenTime, whenWeekday } from '@/lib/core/when';
import { clientsOver } from '@/lib/todo/agenda/clients';
import { loadSchedule } from '@/lib/todo/schedule/load';
import {
  clockOf,
  conflictQuestion,
  daysOf,
  entriesOn,
  scheduleRange,
  SCHEDULE_MAX_DAYS,
  type ScheduleEntry,
} from '@/lib/todo/schedule/model';
import { AskInputError, optionalDate, type AskContext, type AskRow, type AskToolResult } from './db';

/**
 * schedule (plan #3027): what is on a day or a range of days, from the one
 * combined schedule (lib/todo/schedule). Their own events, every calendar
 * they subscribe to, appointments from booking emails, interviews, todos due
 * and dated reminders, each thing once, with a time two sources disagree on
 * kept as a question.
 *
 * A schedule question answered from own events alone said a weekend was free
 * while a party sat on Saturday; this is the lookup that cannot do that.
 */

/** The most rows listed. A busy month fits. */
export const SCHEDULE_ROWS = 120;

function rowOf(entry: ScheduleEntry, timezone: string): AskRow {
  const parsed = parseRef(entry.ref);
  return {
    table: parsed?.table ?? 'todo.events',
    ref: parsed?.id ?? entry.key,
    title: entry.title,
    href: entry.href,
    detail: {
      day: entry.day,
      weekday: whenWeekday(entry.day, { timeZone: 'UTC' }),
      time: clockOf(entry, timezone),
      ends: entry.endsAt ? whenTime(entry.endsAt, { timeZone: timezone }) : null,
      until: entry.lastDay !== entry.day ? entry.lastDay : null,
      kind: entry.kind === 'booked' ? 'booked' : 'due that day',
      from: entry.from,
      where: entry.location,
      about: entry.detail,
      also_in: entry.alsoIn.length > 0 ? entry.alsoIn.map((copy) => copy.from).join(', ') : null,
      conflict: conflictQuestion(entry, timezone),
    },
  };
}

export async function scheduleLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const from = optionalDate(input, 'from') ?? ctx.today;
  const range = scheduleRange(from, optionalDate(input, 'to'));
  if (!range) throw new AskInputError('from must be a day, YYYY-MM-DD.');

  const timezone = ctx.timezone ?? 'UTC';
  const schedule = await loadSchedule(ctx.userId, range, {
    clients: clientsOver(ctx.db),
    now: ctx.now ? new Date(ctx.now) : new Date(),
    timezone,
    enabledModules: ctx.enabledModules,
  });

  const days = daysOf(range);
  const free = days.filter((day) => entriesOn(schedule.entries, day).length === 0);
  const conflicts = schedule.entries.filter((entry) => entry.conflicts.length > 0).length;
  const rows = schedule.entries.slice(0, SCHEDULE_ROWS).map((entry) => rowOf(entry, timezone));

  const notes = [
    `Everything on ${range.from === range.to ? range.from : `${range.from} to ${range.to}`}, morning to night: their own calendar, every calendar they subscribe to, appointments from booking emails, interviews, and the todos and reminders due. Each thing is listed once; also_in names the other places it is.`,
    free.length > 0
      ? `Nothing at all on ${free.join(', ')}.`
      : null,
    conflicts > 0
      ? 'A row with conflict is one thing two places give different times for: ask them which is right rather than choosing one.'
      : null,
    range.cut ? `Only the first ${SCHEDULE_MAX_DAYS} days were read.` : null,
    schedule.entries.length > SCHEDULE_ROWS ? `${schedule.entries.length} entries, showing the first ${SCHEDULE_ROWS}.` : null,
    schedule.failed.length > 0
      ? `These could not be read, so the day may hold more: ${schedule.failed.join(', ')}. Say so.`
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    rows,
    totals: {
      entries: schedule.entries.length,
      booked: schedule.entries.filter((entry) => entry.kind === 'booked').length,
      due: schedule.entries.filter((entry) => entry.kind === 'due').length,
      conflicts,
      days: days.length,
    },
    note: notes.join(' '),
  };
}

/**
 * A wall clock, in a zone, as an instant.
 *
 * Lifted out of lib/todo/tasks/write.ts when events needed the same
 * conversion. Both halves of the module now say "15:00 on Thursday" the same
 * way, which is the only way two readers of the same calendar can agree about
 * when something is.
 *
 * Pure, and free of `server-only`: the conversion is arithmetic over the
 * platform's own zone data, and the pure date modules beside it have to be
 * testable without a database or a request.
 */

import { zoneClock, zoneDay, zoneOffset, zoneParts } from '@/lib/core/when';

/**
 * The instant a wall clock names in a zone.
 *
 * Done by measuring the zone's offset at roughly the right moment rather than
 * by shipping a timezone database: format the candidate instant in the target
 * zone, see how far the result is from what was asked for, and shift by the
 * difference. lib/jobs/calendar/ics.ts does the same thing for the same reason.
 *
 * The measurement is taken twice because the offset can itself change across
 * the shift -- on the two days a year a clock goes forward or back, the first
 * guess lands on the wrong side of the change.
 */
export function wallClockToInstant(day: string, time: string, timezone: string): string {
  const wanted = Date.parse(`${day}T${time}:00Z`);
  let instant = wanted;

  for (let pass = 0; pass < 2; pass += 1) {
    const offset = zoneOffset(instant, timezone);
    const next = wanted - offset;
    if (next === instant) break;
    instant = next;
  }

  return new Date(instant).toISOString();
}

/**
 * What a new event's time fields start on: the next whole hour, an hour long.
 *
 * The next hour rather than this one because an event you are typing at 14:20
 * is almost never one that started at 14:00. Late in the evening there is no
 * next hour left in the day, so the last hour of it is offered instead of
 * rolling over into a start that would be after its own end.
 */
export function nextHourSlot(now: Date, timezone: string): { start: string; end: string } {
  const { hour } = zoneParts(now, timezone);

  const start = Math.min(hour + 1, 23);
  const clock = (value: number) => `${String(value).padStart(2, '0')}:00`;

  return { start: clock(start), end: start === 23 ? '23:59' : clock(start + 1) };
}

/**
 * The day and the clock an instant reads as, in a zone.
 *
 * For putting a stored `due_at` back into a date field and a time field. The
 * label beside those fields is formatted in the account's zone, so the fields
 * have to be too: read in Tokyo, a task due at 23:00 UTC is tomorrow, and a
 * date input seeded from UTC would open on the wrong day and quietly move it
 * a day back the moment anything else was changed.
 *
 * Read through when.ts rather than arithmetic on the Date, because the
 * browser's own zone is not the one being asked about.
 */

/** `YYYY-MM-DD`, as a date input wants it. */
export function dayIn(iso: string, timezone: string): string {
  return zoneDay(iso, timezone);
}

/** `HH:MM`, as a time input wants it. */
export function clockIn(iso: string, timezone: string): string {
  return zoneClock(iso, timezone);
}

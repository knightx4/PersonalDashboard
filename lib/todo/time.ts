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
    const offset = offsetOf(new Date(instant), timezone);
    const next = wanted - offset;
    if (next === instant) break;
    instant = next;
  }

  return new Date(instant).toISOString();
}

/** How far ahead of UTC a zone is, in milliseconds, at a given instant. */
function offsetOf(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const local = Date.parse(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
  );

  return local - at.getTime();
}

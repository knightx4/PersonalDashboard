/**
 * Where an interview opens in the calendar (note 7b1975cb).
 *
 * An invite Google sent carries its event id in the ICS UID, as
 * `<id>@google.com`, and Google opens an event from `eid`: the id and the
 * calendar it is on, separated by a space, in base64 without padding. The
 * calendar is the mailbox the invite arrived in. Without both, the link opens
 * the interview's day in Google Calendar instead, which is one tap from the
 * event.
 */
export function interviewCalendarHref(input: {
  icsUid: string | null;
  scheduledAt: string | null;
  /** The mailbox the invite arrived in, which is the calendar it is on. */
  calendarEmail: string | null;
  timezone: string;
}): string | null {
  const { icsUid, scheduledAt, calendarEmail, timezone } = input;
  const eventId = icsUid?.match(/^([^@\s]+)@google\.com$/i)?.[1];
  if (eventId && calendarEmail) {
    const eid = Buffer.from(`${eventId} ${calendarEmail}`, 'utf8').toString('base64').replace(/=+$/, '');
    return `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}`;
  }
  if (!scheduledAt) return null;
  const at = new Date(scheduledAt);
  if (!Number.isFinite(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const day = `https://calendar.google.com/calendar/r/day/${part('year')}/${part('month')}/${part('day')}`;
  return calendarEmail ? `${day}?authuser=${encodeURIComponent(calendarEmail)}` : day;
}

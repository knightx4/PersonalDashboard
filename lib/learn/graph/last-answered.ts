/**
 * When the last question was answered, as one line.
 *
 * Pure, and it says one thing: today, or the date. There is no streak here and
 * there is not going to be one -- a run count turns a five-minute habit into
 * something you can lose, and the point of the session is that missing a day
 * costs nothing.
 */
function dayIn(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Null when nothing has ever been answered, which the screen says nothing
 * about: a line about a session that has never happened is noise on the one
 * screen where somebody is about to start.
 */
export function lastAnsweredLine(
  answeredAt: string | null,
  now: Date,
  timezone: string,
): string | null {
  if (!answeredAt) return null;

  const answered = new Date(answeredAt);
  if (Number.isNaN(answered.getTime())) return null;

  const answeredDay = dayIn(answered, timezone);
  const today = dayIn(now, timezone);
  if (answeredDay === today) return 'You answered one today.';

  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    // The year only when it is not this one. "14 March" is what somebody
    // means by a date three weeks ago; "14 March 2025" is what they mean by
    // one eighteen months ago.
    ...(answeredDay.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
  }).format(answered);

  return `The last one was on ${date}.`;
}

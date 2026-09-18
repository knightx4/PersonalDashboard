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
 * Today, or the date, or nothing at all.
 *
 * Null when the timestamp is missing or will not parse, which every caller
 * renders as no line rather than as a sentence about never.
 */
function dayOrToday(
  at: string | null,
  now: Date,
  timezone: string,
): { today: true } | { today: false; date: string } | null {
  if (!at) return null;

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;

  const day = dayIn(when, timezone);
  const today = dayIn(now, timezone);
  if (day === today) return { today: true };

  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    // The year only when it is not this one. "14 March" is what somebody
    // means by a date three weeks ago; "14 March 2025" is what they mean by
    // one eighteen months ago.
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
  }).format(when);

  return { today: false, date };
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
  const when = dayOrToday(answeredAt, now, timezone);
  if (!when) return null;
  return when.today ? 'You answered one today.' : `The last one was on ${when.date}.`;
}

/**
 * When a claim was last actually asked about, for the row it sits on.
 *
 * Null for a claim with no date -- one settled by inference or because you
 * said so -- and the screens show no line at all rather than "never checked".
 * The state already says how it was established; saying it twice, once in the
 * negative, would be the row arguing with itself.
 */
export function lastCheckedLine(
  testedAt: string | null,
  now: Date,
  timezone: string,
): string | null {
  const when = dayOrToday(testedAt, now, timezone);
  if (!when) return null;
  return when.today ? 'Last checked today.' : `Last checked on ${when.date}.`;
}

/**
 * Whose words the claim is in.
 *
 * Here rather than beside the rewrite itself because it is the same date in
 * the same timezone as the two lines above, said the same way. Always a line:
 * a claim nobody has touched is in the app's words, and that is a fact about
 * it worth saying out loud, not an absence to leave blank. A timestamp that
 * will not parse still means somebody wrote the sentence, so it says that
 * much and drops the date.
 */
export function claimWordingLine(
  rewrittenAt: string | null,
  now: Date,
  timezone: string,
): string {
  if (!rewrittenAt) return 'In the app’s words.';

  const when = dayOrToday(rewrittenAt, now, timezone);
  if (!when) return 'In your words.';
  return when.today ? 'In your words, written today.' : `In your words, written on ${when.date}.`;
}

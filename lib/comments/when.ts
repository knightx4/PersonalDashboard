/**
 * When a comment was written, as a thread shows it.
 *
 * Two forms, and which one you get is the question being asked. Inside a week
 * the useful fact is how long ago -- a thread is a conversation, and "3h ago"
 * says whether the answer you are reading arrived before or after the thing
 * you did this morning. Past a week nobody counts days any more, so it becomes
 * the date.
 *
 * Pure and here rather than in the component so the rule is pinned by a test,
 * and so the two halves of it cannot drift apart.
 */

/** A week, after which the relative form stops meaning anything. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The short form: `just now`, `12m ago`, `3h ago`, `2d ago`, or the date.
 *
 * `now` is zero before the clock is read, which is the value the server and
 * the first client render share. Both draw the date then, so the relative
 * figure appears on the tick after mount rather than being two different
 * strings on the two sides of hydration.
 *
 * Never counts forward: a browser clock a few seconds behind the row's own
 * timestamp is ordinary, and "in 4s" is not.
 */
export function commentWhen(createdAt: string, now: number): string {
  const written = new Date(createdAt).getTime();
  if (now === 0 || Number.isNaN(written)) return createdAt.slice(0, 10);

  const since = Math.max(0, now - written);
  if (since >= WEEK_MS) return createdAt.slice(0, 10);

  const minutes = Math.floor(since / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The whole timestamp, for the element's title.
 *
 * "3h ago" is the right thing to read and the wrong thing to check a sequence
 * against, so the exact minute stays available without being on screen. UTC as
 * stored, the same way the plan page writes a claim's time.
 */
export function exactTime(createdAt: string): string {
  return createdAt.replace('T', ' ').slice(0, 16);
}

/** Month names for the short date. English and UTC, the same as `exactTime`. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `10 Sep`, read off the stored string rather than converted through a clock.
 *
 * The year is left out on purpose. It would take the string past the width the
 * strip has, and the whole timestamp is on the title anyway, so a comment from
 * last year reads `10 Sep` too.
 */
function shortDate(createdAt: string): string {
  const month = MONTHS[Number(createdAt.slice(5, 7)) - 1];
  const day = Number(createdAt.slice(8, 10));
  if (!month || !day) return createdAt.slice(0, 10);
  return `${day} ${month}`;
}

/**
 * The same fact as `commentWhen`, in the width a 40px strip has: `now`, `12m`,
 * `3h`, `1d`, or `10 Sep`.
 *
 * A message grouped under the one above it has no header to put a time in, so
 * the time goes in the strip the author mark would be in -- about 40px from
 * the card's inner edge. `commentWhen`'s own output does not fit there: a full
 * date needs around 70px, which is what #594 measured. Hence a second wording
 * rather than a wider strip (#640).
 *
 * `now` is zero until the clock is read, and at zero this returns the date, so
 * the server and the first client render draw the same string.
 */
export function shortWhen(createdAt: string, now: number): string {
  const written = new Date(createdAt).getTime();
  if (now === 0 || Number.isNaN(written)) return shortDate(createdAt);

  const since = Math.max(0, now - written);
  if (since >= WEEK_MS) return shortDate(createdAt);

  const minutes = Math.floor(since / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

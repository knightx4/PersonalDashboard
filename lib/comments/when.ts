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

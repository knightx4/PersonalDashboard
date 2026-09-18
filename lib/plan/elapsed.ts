/**
 * How long a step has been underway.
 *
 * Pure and here rather than in the page, so the one rule the plan has about
 * reading a clock is pinned by a test: the question a running step raises is
 * "is this still moving or is it stuck", and the answer has to be legible at a
 * glance. The coarsest unit that still says it — minutes under an hour, hours
 * and minutes under a day, days after that — because "2h 40m" answers that
 * question where "160 minutes" makes you do the sum first.
 *
 * Never negative: a clock a few seconds ahead of the row's own timestamp is a
 * normal thing between a server and a browser, and "-1m ago" is not.
 */
/**
 * How long a claim may sit before the page stops calling it live.
 *
 * A session claims a step, works it, and closes it; the whole of that is
 * minutes to an hour. What it does not do is release the claim when it dies,
 * so a routine that fell over at lunchtime leaves a row saying "In progress"
 * with a pulsing dot next to it for the rest of the day — which is how #144
 * came to be reported as "still listed as running even though its done in the
 * routine".
 *
 * Two hours is generous for the longest step anybody has built and short
 * enough to catch the same afternoon. It is a reading of the row, not a state
 * written to it: only the person can say whether the work happened, so the
 * page says nobody has touched it and leaves the row alone.
 *
 * It is the fallback rather than the answer now. `claimLiveness` in
 * `liveness.ts` reads a claim off what its run pushed and falls back to this
 * mark when there is no run to read, which is why the two numbers are the
 * same: #524 set the ended mark here deliberately.
 */
export const STALLED_AFTER_MINUTES = 120;

/**
 * Whether a step's claim has gone quiet — underway for longer than any
 * session takes, with nothing since.
 *
 * False at `now === 0`, the clock's pre-mount value, so the server and the
 * first client render agree and the badge does not change shape under the
 * reader's eyes on hydration.
 */
export function isStalledClaim(startedAt: string, now: number): boolean {
  if (now === 0) return false;
  return (now - new Date(startedAt).getTime()) / 60_000 >= STALLED_AFTER_MINUTES;
}

/**
 * A number of minutes as the coarsest unit that still says it.
 *
 * Shared between the two directions on purpose: a step that has been going
 * `2h 40m` and a night that stops in `2h 40m` are the same quantity read from
 * either side, and two vocabularies for it on one page would make the reader
 * do the conversion.
 */
function coarse(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }

  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

export function elapsedSince(startedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
  return minutes < 1 ? 'just now' : coarse(minutes);
}

/**
 * How long there is left until an instant, in the same words.
 *
 * Written for the overnight runner's stop time, which is the first thing on
 * the plan that is read forwards rather than backwards. Never negative: an
 * instant already past reads as under a minute, and whoever is drawing it has
 * to say something different about a deadline that has gone by anyway -- a
 * `-2h` left to run would let them not.
 */
export function remainingUntil(at: string, now: number): string {
  const minutes = Math.max(0, Math.floor((new Date(at).getTime() - now) / 60_000));
  return minutes < 1 ? 'under a minute' : coarse(minutes);
}

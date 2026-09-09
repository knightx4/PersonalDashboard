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
export function elapsedSince(startedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
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

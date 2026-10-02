/**
 * The claim a check of the inspiration playlist holds while it runs (plan
 * #1411), apart from lib/dev/inspiration/check.ts so the tab can say a check
 * is going without importing the server-only run.
 */

/** How long a claim holds before it counts as a run that died. Longer than any run may take. */
export const CHECK_LOCK_MS = 10 * 60_000;

/** Whether a claim taken at `startedAt` still holds at `now`. */
export function checkRunning(startedAt: string | null | undefined, now: Date): boolean {
  if (!startedAt) return false;
  const at = Date.parse(startedAt);
  return Number.isFinite(at) && now.getTime() - at < CHECK_LOCK_MS;
}

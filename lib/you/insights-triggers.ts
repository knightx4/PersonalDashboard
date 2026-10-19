/**
 * When an insights run starts by itself (plan #2413.10). The daily cron asks
 * once a day (inngest/you/insights-tick.ts); these rules decide whether the
 * answer is a run. They hold no clock and no client, so the tests fix both.
 *
 *   - Never two at once: a run queued or running, not yet past the stale mark,
 *     skips everything. A stale one is marked failed when the next is queued,
 *     which is why it does not count here.
 *   - Whatever the cause, a run asked for in the last day holds off the next,
 *     so a run that keeps failing is tried once a day, not on every tick.
 *   - Monthly: the last ready run finished more than thirty days ago, or
 *     there is none. Nothing else starts a run on its own: a change in the
 *     person's life brings cards back through their tripwires instead
 *     (plan #2413.6), and Look again is the person's own press.
 */

export const MONTHLY_GAP_MS = 30 * 24 * 60 * 60 * 1000;
export const RETRY_GAP_MS = 24 * 60 * 60 * 1000;

export type TickRun = {
  status: 'queued' | 'running' | 'ready' | 'failed';
  requestedAt: string;
  finishedAt: string | null;
};

export type TickDecision = { start: true } | { start: false; skipped: string };

export function decideInsightRun(input: {
  now: number;
  /** The newest run of any status, if any. */
  latest: TickRun | null;
  /** The newest run that finished ready, if any. */
  lastReady: TickRun | null;
  staleAfterMs: number;
}): TickDecision {
  const { now, latest, lastReady } = input;
  const asked = latest ? Date.parse(latest.requestedAt) : NaN;

  if (latest && (latest.status === 'queued' || latest.status === 'running')) {
    if (!Number.isFinite(asked) || now - asked <= input.staleAfterMs) {
      return { start: false, skipped: 'a run is already queued or running' };
    }
  }
  if (Number.isFinite(asked) && now - asked < RETRY_GAP_MS) {
    return { start: false, skipped: 'a run was asked for in the last day' };
  }

  const readyAt = lastReady ? Date.parse(lastReady.finishedAt ?? lastReady.requestedAt) : NaN;
  if (!Number.isFinite(readyAt) || now - readyAt > MONTHLY_GAP_MS) return { start: true };
  return { start: false, skipped: 'the last run is less than a month old' };
}

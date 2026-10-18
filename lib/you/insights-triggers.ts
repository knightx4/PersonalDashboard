import type { InsightRunReason } from '@/lib/you/insights';

/**
 * When an insights run starts by itself (plan #2413.6). The daily cron asks
 * once a day (inngest/you/insights-tick.ts); these rules decide whether the
 * answer is a run. They hold no clock and no client, so the tests fix both.
 *
 *   - Never two at once: a run queued or running, not yet past the stale mark,
 *     skips everything. A stale one is marked failed by the start, which is
 *     why it does not count here.
 *   - Whatever the cause, a run asked for in the last day holds off the next,
 *     so a change trigger queues at most one run a day and a run that keeps
 *     failing is tried once a day, not on every tick.
 *   - Change: a rejection or offer on an application, or a goal marked done,
 *     since the newest run was asked for.
 *   - Weekly: the last ready run finished more than seven days ago, or there
 *     is none.
 */

export const WEEKLY_GAP_MS = 7 * 24 * 60 * 60 * 1000;
export const CHANGE_GAP_MS = 24 * 60 * 60 * 1000;

/** The application event kinds that count as a big change. */
export const CHANGE_EVENT_KINDS = ['rejection', 'offer'] as const;

export type TickRun = {
  status: 'queued' | 'running' | 'ready' | 'failed';
  requestedAt: string;
  finishedAt: string | null;
};

/** One thing that happened, with when and how to say it in a line. */
export type ChangeEvent = { at: string; label: string };

export type TickDecision =
  | { start: false; skipped: string }
  | { start: true; reason: Extract<InsightRunReason, 'weekly' | 'change'>; change: string | null };

export function decideInsightRun(input: {
  now: number;
  /** The newest run of any status, if any. */
  latest: TickRun | null;
  /** The newest run that finished ready, if any. */
  lastReady: TickRun | null;
  /** Rejections, offers and goals done, newest first. */
  events: ChangeEvent[];
  staleAfterMs: number;
}): TickDecision {
  const { now, latest, lastReady, events } = input;
  const asked = latest ? Date.parse(latest.requestedAt) : NaN;

  if (latest && (latest.status === 'queued' || latest.status === 'running')) {
    if (!Number.isFinite(asked) || now - asked <= input.staleAfterMs) {
      return { start: false, skipped: 'a run is already queued or running' };
    }
  }
  if (Number.isFinite(asked) && now - asked < CHANGE_GAP_MS) {
    return { start: false, skipped: 'a run was asked for in the last day' };
  }

  const since = Number.isFinite(asked) ? asked : -Infinity;
  const fresh = events.filter((e) => Date.parse(e.at) > since);
  if (fresh.length > 0) {
    const more = fresh.length > 1 ? ` (and ${fresh.length - 1} more)` : '';
    return { start: true, reason: 'change', change: `${fresh[0].label}${more}` };
  }

  const readyAt = lastReady ? Date.parse(lastReady.finishedAt ?? lastReady.requestedAt) : NaN;
  if (!Number.isFinite(readyAt) || now - readyAt > WEEKLY_GAP_MS) {
    return { start: true, reason: 'weekly', change: null };
  }
  return { start: false, skipped: 'the last run is less than a week old and nothing large has happened' };
}

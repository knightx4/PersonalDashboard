/**
 * When Dash writes new questions by itself (plan #2635.1). The daily cron asks
 * once a day (inngest/you/dash-questions-tick.ts); these rules decide whether
 * the answer is a question run. They hold no clock and no client, so the tests
 * fix both. The Ask button on the Answer tab is the person's own press and is
 * not held by any of this.
 *
 *   - Never two at once: a run queued or running, not yet past the stale mark,
 *     skips everything. A stale one is marked failed when the next is queued.
 *   - Weekly at most: a run of any status asked for in the last seven days
 *     holds off the next, so a run that keeps failing is tried once a week.
 *   - Only when the tab is running low: three or more open questions wait for
 *     the person first.
 *   - Only after they have taken part: an answer or a skip since the last
 *     ready run finished, or no run has ever finished ready. Questions nobody
 *     answers do not pile up while the person is away.
 */

import type { DashQuestionRunStatus } from '@/lib/you/dash-questions-run';

export const WEEKLY_GAP_MS = 7 * 24 * 60 * 60 * 1000;

/** Fewer open questions than this lets a run start. */
export const OPEN_QUESTIONS_LOW = 3;

export type QuestionTickRun = {
  status: DashQuestionRunStatus;
  requestedAt: string;
  finishedAt: string | null;
};

export type QuestionTickDecision = { start: true } | { start: false; skipped: string };

export function decideQuestionRun(input: {
  now: number;
  /** The newest run of any status, if any. */
  latest: QuestionTickRun | null;
  /** The newest run that finished ready, if any. */
  lastReady: QuestionTickRun | null;
  /** How many questions are open on the tab. */
  openCount: number;
  /** The newest answered_at or skipped_at across their questions, if any. */
  lastResponseAt: string | null;
  staleAfterMs: number;
}): QuestionTickDecision {
  const { now, latest, lastReady } = input;
  const asked = latest ? Date.parse(latest.requestedAt) : NaN;

  if (latest && (latest.status === 'queued' || latest.status === 'running')) {
    if (!Number.isFinite(asked) || now - asked <= input.staleAfterMs) {
      return { start: false, skipped: 'a question run is already queued or running' };
    }
  }
  if (Number.isFinite(asked) && now - asked < WEEKLY_GAP_MS) {
    return { start: false, skipped: 'a question run was asked for in the last week' };
  }
  if (input.openCount >= OPEN_QUESTIONS_LOW) {
    return { start: false, skipped: `${input.openCount} questions are still open` };
  }

  if (!lastReady) return { start: true };
  const finished = Date.parse(lastReady.finishedAt ?? lastReady.requestedAt);
  const responded = input.lastResponseAt ? Date.parse(input.lastResponseAt) : NaN;
  if (Number.isFinite(responded) && (!Number.isFinite(finished) || responded > finished)) return { start: true };
  return { start: false, skipped: 'nothing was answered or skipped since the last run' };
}

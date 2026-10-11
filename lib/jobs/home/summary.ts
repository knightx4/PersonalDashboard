import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { isLive } from '@/lib/jobs/pipeline';
import {
  PIPELINE_STAGES,
  pipelineHref,
  sentWithin,
  type PipelineStageKey,
} from '@/lib/jobs/pipeline-view';
import { roundsOf } from '@/lib/jobs/interview-groups';
import { INTERVIEW_HORIZON_DAYS } from '@/lib/jobs/today/load';

/**
 * The few numbers on Today (plan #1151, #1591): where the search stands.
 *
 * PURE, and counted from the same rows Pipeline reads, so each number opens
 * Pipeline narrowed to exactly what it counted (`stageHref`, `sentHref`).
 * No model call.
 *
 * Live is Pipeline's rule (`isLive`: not closed, leads included), and the
 * stages are PIPELINE_STAGES, the board's columns folded the way the board
 * folds them. Together the stages are every live status, so they add up to
 * the live count.
 */

export const SENT_WINDOW_DAYS = 7;
export { INTERVIEW_HORIZON_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pipeline's table, narrowed to the live applications at one stage. */
export function stageHref(key: PipelineStageKey): string {
  return pipelineHref({}, { view: 'table', stage: key });
}

/** Pipeline's table, narrowed to what was sent in the window, live or closed. */
export function sentHref(days: number = SENT_WINDOW_DAYS): string {
  return pipelineHref({}, { view: 'table', status: 'all', sent: String(days) });
}

export interface SummaryApplication {
  status: ApplicationStatus;
  submittedAt: string | null;
  confirmationReceivedAt: string | null;
}

export interface SummaryInterview {
  id: string;
  scheduledAt: string | null;
  /** False when only the day is settled; the day then counts as upcoming. */
  timeKnown: boolean | null;
  groupId: string | null;
}

export interface SearchSummary {
  /** Applications not closed, leads included: the sum of the stages. */
  live: number;
  byStage: Array<{ key: PipelineStageKey; label: string; count: number }>;
  /** Sent in the last SENT_WINDOW_DAYS days, whatever has happened since. */
  sentRecently: number;
  /**
   * Rounds still upcoming by the Interviews tab's rule whose first
   * conversation starts within INTERVIEW_HORIZON_DAYS. Null when the
   * interviews could not be read, which the page says rather than showing 0.
   */
  interviewsSoon: number | null;
}

export function summariseSearch(
  applications: readonly SummaryApplication[],
  interviews: readonly SummaryInterview[] | null,
  now: Date,
): SearchSummary {
  const nowMs = now.getTime();

  const byStage = PIPELINE_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    count: applications.filter((app) =>
      (stage.statuses as readonly ApplicationStatus[]).includes(app.status),
    ).length,
  }));

  // Pipeline's own rule, so "Sent in the last 7 days" is the list it opens.
  const sentRecently = applications.filter((app) => sentWithin(app, SENT_WINDOW_DAYS, now)).length;

  return {
    live: applications.filter((app) => isLive(app.status)).length,
    byStage,
    sentRecently,
    interviewsSoon: interviews === null ? null : countInterviewsSoon(interviews, nowMs),
  };
}

/**
 * One per round, as the Interviews tab lists them, so a superday of four
 * conversations counts once. A round is upcoming until its last conversation
 * is over, and a day-only round until that day ends -- the tab's splitByTime.
 */
function countInterviewsSoon(interviews: readonly SummaryInterview[], nowMs: number): number {
  const horizon = nowMs + INTERVIEW_HORIZON_DAYS * DAY_MS;
  const groupIds = [...new Set(interviews.map((i) => i.groupId).filter((id): id is string => !!id))];
  const rounds = roundsOf(
    interviews,
    groupIds.map((id) => ({ id, label: null, notes: '' })),
  );

  let count = 0;
  for (const round of rounds) {
    const times = round.interviews
      .filter((i) => i.scheduledAt !== null)
      .map((i) => ({ at: new Date(i.scheduledAt!).getTime(), timeKnown: i.timeKnown !== false }))
      .filter((t) => Number.isFinite(t.at));
    if (times.length === 0) continue;
    const first = Math.min(...times.map((t) => t.at));
    const last = times.reduce((a, b) => (a.at >= b.at ? a : b));
    const endsAt = last.at + (last.timeKnown ? 0 : DAY_MS);
    if (endsAt >= nowMs && first <= horizon) count += 1;
  }
  return count;
}

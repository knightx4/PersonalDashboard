import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { isTerminal } from '@/lib/jobs/pipeline';
import { roundsOf } from '@/lib/jobs/interview-groups';
import { INTERVIEW_HORIZON_DAYS } from '@/lib/jobs/today/load';

/**
 * The few numbers at the top of Home (plan #1151): where the search stands.
 *
 * PURE, and counted from the same rows the Pipeline and Interviews tabs read,
 * so each number can be checked against the tab it links to. No model call.
 *
 * The stages are the board's columns from Submitted to Offer, folded the way
 * components/jobs/pipeline/board.tsx folds them: `submitted` and
 * `acknowledged` are one column, and so are `in_process` and `final_round`.
 * Leads and drafts are not applications yet, so they are not counted as live;
 * the four closed statuses (TERMINAL_STATUSES) are left out entirely.
 */

export const SENT_WINDOW_DAYS = 7;
export { INTERVIEW_HORIZON_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

export const SUMMARY_STAGES = [
  { key: 'submitted', label: 'Submitted', statuses: ['submitted', 'acknowledged'] },
  { key: 'in_process', label: 'In process', statuses: ['in_process', 'final_round'] },
  { key: 'offer', label: 'Offer', statuses: ['offer'] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly ApplicationStatus[];
}>;

export type SummaryStageKey = (typeof SUMMARY_STAGES)[number]['key'];

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
  /** Applications sent and not closed: the sum of the stages. */
  live: number;
  byStage: Array<{ key: SummaryStageKey; label: string; count: number }>;
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

  const byStage = SUMMARY_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    count: applications.filter(
      (app) =>
        !isTerminal(app.status) &&
        (stage.statuses as readonly ApplicationStatus[]).includes(app.status),
    ).length,
  }));

  // An application created from its confirmation email can carry the
  // confirmation's time and no separate send time; that is when it was sent.
  const sentSince = nowMs - SENT_WINDOW_DAYS * DAY_MS;
  const sentRecently = applications.filter((app) => {
    const sent = app.submittedAt ?? app.confirmationReceivedAt;
    if (!sent) return false;
    const at = new Date(sent).getTime();
    return Number.isFinite(at) && at >= sentSince && at <= nowMs;
  }).length;

  return {
    live: byStage.reduce((sum, stage) => sum + stage.count, 0),
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

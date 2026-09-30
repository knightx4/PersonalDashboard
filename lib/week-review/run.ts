import type { SpendReport } from '@/lib/core/spend/pricing';
import { addDays } from '@/lib/todo/tasks/model';
import type { WeekFacts } from './facts';
import {
  checkReview,
  isQuietWeek,
  plainReview,
  reviewWeekDue,
  type PreviousReview,
  type RawReview,
  type ReviewDropReason,
  type ReviewObservation,
} from './review';

/**
 * One person's weekly review (plan #1232), following lib/day-brief/run.ts:
 * on Sunday from 9am New York time, count the week just gone, have Dash
 * write it up, store it under the week, and hand the stored row to `written`.
 *
 * A week is written once. The row is looked for before anything is counted
 * or any model is asked, and the insert does nothing when the row is already
 * there, so a retried call neither pays twice nor stores twice. Without a
 * key, or when the call fails or returns nothing usable, the plain version
 * built from the facts is stored instead. A week with nothing counted in it
 * or the week before gets the plain version without a call.
 */

export type WeekReviewRow = {
  user_id: string;
  week: string;
  timezone: string;
  facts: WeekFacts;
  observations: ReviewObservation[];
  change: string | null;
  change_kept: boolean | null;
  source: 'model' | 'plain';
  model: string | null;
};

export type WeekReviewPorts = {
  /** Whether this person's review for this week is already stored. */
  hasReview(userId: string, week: string): Promise<boolean>;
  /** The week's counted facts (lib/week-review/load.ts). */
  facts(userId: string, week: string): Promise<WeekFacts>;
  /** Last week's stored review, or null when there is none. */
  previous(userId: string, week: string): Promise<PreviousReview | null>;
  /** What the home page's weekly observations said since the week began. */
  homeSaid(userId: string, week: string): Promise<string[]>;
  /** The model's review, unchecked; null when there is no model to ask. */
  write(
    input: { facts: WeekFacts; previous: PreviousReview | null; homeSaid: string[] },
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; review: RawReview | null } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Stores the row; false when a review for the week was already there. */
  save(row: WeekReviewRow): Promise<boolean>;
  /**
   * Called once the row is stored, and only then. The phone notification
   * (plan #1234) is sent from here.
   */
  written?(row: WeekReviewRow): Promise<void>;
};

export type WeekReviewResult =
  | { status: 'not-due' }
  | { status: 'already-written'; week: string }
  | {
      status: 'written';
      week: string;
      source: 'model' | 'plain';
      observations: number;
      dropped: ReviewDropReason[];
    };

export async function runWeekReviewFor(ports: WeekReviewPorts, userId: string, now: Date): Promise<WeekReviewResult> {
  const week = reviewWeekDue(now);
  if (!week) return { status: 'not-due' };
  if (await ports.hasReview(userId, week)) return { status: 'already-written', week };

  const facts = await ports.facts(userId, week);
  let text = plainReview(facts);
  let source: WeekReviewRow['source'] = 'plain';
  let model: string | null = null;
  let dropped: ReviewDropReason[] = [];

  if (!isQuietWeek(facts)) {
    const [previous, homeSaid] = await Promise.all([
      ports.previous(userId, addDays(week, -7)),
      ports.homeSaid(userId, week),
    ]);
    const reports: SpendReport[] = [];
    try {
      const reply = await ports.write({ facts, previous, homeSaid }, (report) => reports.push(report));
      if (reply) {
        const checked = checkReview(reply.review, facts, previous);
        dropped = checked.dropped;
        if (checked.review) {
          text = checked.review;
          source = 'model';
          model = reply.model;
        }
      }
    } catch {
      // The plain version stands in; the failure costs the wording, not the week.
    } finally {
      for (const report of reports) await ports.ledger(userId, report);
    }
  }

  const row: WeekReviewRow = {
    user_id: userId,
    week,
    timezone: facts.timezone,
    facts,
    observations: text.observations,
    change: text.change,
    change_kept: text.change_kept,
    source,
    model,
  };
  if (!(await ports.save(row))) return { status: 'already-written', week };
  await ports.written?.(row);
  return { status: 'written', week, source, observations: row.observations.length, dropped };
}

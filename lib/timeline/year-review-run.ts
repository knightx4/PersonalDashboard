import type { SpendReport } from '@/lib/core/spend/pricing';
import { monthKeyOf } from './months';
import {
  canWriteReview,
  checkParagraphs,
  currentYear,
  MIN_EVENTS_TO_WRITE,
  shownNumbers,
  summariseYear,
  yearTotals,
  yearWindow,
  type ParagraphDropReason,
  type RawParagraph,
  type YearParagraph,
  type YearTotals,
} from './year-review';
import type { TimelineEvent } from './timeline';

/**
 * Writing one person's review of one year (plan #1121): read the year from
 * the timeline, count it, have the model write around the counts, keep the
 * paragraphs that pass the checks, and store the lot.
 *
 * The same run serves the button on the page, under the person's session,
 * and the clock on 2 January, under the service role; the ports are what
 * differ. A year still being lived in is read up to now and stored as not
 * complete, so it can be written again. A year that has ended is read whole,
 * stored as complete, and never written again.
 *
 * Nothing is stored when there is nothing to write: a year with fewer than
 * MIN_EVENTS_TO_WRITE events, no key for the model, or no paragraph that
 * passed. The page shows the counts from the timeline in those cases, and
 * the next press or the next clock can try again.
 */

export type YearReviewRow = {
  user_id: string;
  year: number;
  timezone: string;
  through: string;
  complete: boolean;
  events: number;
  totals: YearTotals;
  paragraphs: YearParagraph[];
  model: string;
};

export type YearReviewPorts = {
  /** Whether this person's review of this year was written after the year ended; null when there is none. */
  stored(userId: string, year: number): Promise<{ complete: boolean } | null>;
  /** This person's timeline events in [from, to). */
  timeline(userId: string, from: string, to: string): Promise<TimelineEvent[]>;
  /** The model's paragraphs, unchecked; null when there is no model to ask. */
  write(
    summary: string,
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; paragraphs: RawParagraph[] } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Insert the review, or replace the one written before the year ended. */
  save(row: YearReviewRow): Promise<void>;
};

export type YearReviewResult =
  | { status: 'not-yet' }
  | { status: 'already-complete' }
  | { status: 'too-few'; events: number }
  | { status: 'no-model' }
  | { status: 'nothing-kept'; dropped: ParagraphDropReason[] }
  | { status: 'written'; events: number; paragraphs: number; dropped: ParagraphDropReason[] };

export async function writeYearReviewFor(
  ports: YearReviewPorts,
  input: { userId: string; year: number; timezone: string; now: Date },
): Promise<YearReviewResult> {
  const { userId, year, timezone, now } = input;
  const current = currentYear(now, timezone);
  if (year > current) return { status: 'not-yet' };
  const stored = await ports.stored(userId, year);
  if (!canWriteReview(year, current, stored)) return { status: 'already-complete' };

  const complete = year < current;
  const window = yearWindow(year, timezone);
  const through = complete ? window.to : now.toISOString();
  const events = await ports.timeline(userId, window.from, through);
  if (events.length < MIN_EVENTS_TO_WRITE) return { status: 'too-few', events: events.length };

  const totals = yearTotals(events, year, timezone, complete ? `${year}-12` : monthKeyOf(through, timezone));
  const { summary, events: ids } = summariseYear(events, totals, { timezone, through, complete });

  const reports: SpendReport[] = [];
  let reply;
  try {
    reply = await ports.write(summary, (report) => reports.push(report));
  } finally {
    for (const report of reports) await ports.ledger(userId, report);
  }
  if (!reply) return { status: 'no-model' };

  const { kept, dropped } = checkParagraphs(reply.paragraphs, ids, shownNumbers(totals));
  if (kept.length === 0) return { status: 'nothing-kept', dropped };

  await ports.save({
    user_id: userId,
    year,
    timezone,
    through,
    complete,
    events: events.length,
    totals,
    paragraphs: kept,
    model: reply.model,
  });
  return { status: 'written', events: events.length, paragraphs: kept.length, dropped };
}

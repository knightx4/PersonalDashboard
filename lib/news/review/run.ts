import type { SpendReport } from '@/lib/core/spend/pricing';
import { chooseReviewStories, reviewItem, type ReviewInput, type ReviewItem, type ReviewPick } from './choose';
import type { ReviewReply } from './reply';

/**
 * One person's daily review (plan #1615, under #1612).
 *
 * Called every hour by the news-review cron. From 8pm in the person's own
 * timezone until midnight, if the day has no review yet, it reads the
 * newsletters of the 24 hours up to 8pm, chooses the stories (choose.ts),
 * has Dash write the overview and one line per story in one call, and stores
 * the day's row in news.daily_reviews.
 *
 * A day whose newsletters give no story to list makes no call and writes no
 * row. A failed call stores a row holding only the error, so the tab can say
 * so; that row is replaced by the next hour's try while the evening lasts.
 * The spend is recorded whether or not the reply was usable.
 */

/** The hour, in the person's own zone, the review is written at. */
export const REVIEW_HOUR = 20;

export type ReviewRow = {
  user_id: string;
  day: string;
  overview: string | null;
  items: ReviewItem[];
  written_at: string;
  error: string | null;
};

export type ReviewPorts = {
  /** Whether this day already has a written review (an error-only row does not count). */
  hasReview(userId: string, day: string): Promise<boolean>;
  /** The person's summarised news newsletters in the window, their senders, story groups and hidden topics. */
  inputs(userId: string, since: Date, until: Date): Promise<Omit<ReviewInput, 'until'>>;
  /** Dash's overview and lines; null when there is no model to ask. Throws on a failed call. */
  write(picks: readonly ReviewPick[], onSpend: (report: SpendReport) => void): Promise<ReviewReply | null>;
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Upsert onto (user_id, day). */
  save(row: ReviewRow): Promise<void>;
};

export type ReviewResult =
  | { status: 'not-yet' }
  | { status: 'already'; day: string }
  | { status: 'no-news'; day: string }
  | { status: 'no-key'; day: string }
  | { status: 'written'; day: string; stories: number }
  | { status: 'failed'; day: string; error: string };

/**
 * The day to write a review for at `now` in `timezone`, and the moment the
 * review covers up to: 8pm that day, so each review covers exactly the 24
 * hours since the last one however late in the evening the run comes. Null
 * before 8pm.
 */
export function reviewClock(timezone: string, now: Date): { day: string; until: Date } | null {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  if (!(hour >= REVIEW_HOUR)) return null;
  const since8pm =
    ((hour - REVIEW_HOUR) * 3600 + Number(get('minute')) * 60 + Number(get('second'))) * 1000 +
    now.getUTCMilliseconds();
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    until: new Date(now.getTime() - since8pm),
  };
}

export async function runReviewFor(
  ports: ReviewPorts,
  person: { userId: string; timezone: string },
  now: Date,
  windowMs: number,
): Promise<ReviewResult> {
  const clock = reviewClock(person.timezone, now);
  if (!clock) return { status: 'not-yet' };
  const { day, until } = clock;
  if (await ports.hasReview(person.userId, day)) return { status: 'already', day };

  const input = await ports.inputs(person.userId, new Date(until.getTime() - windowMs), until);
  const picks = chooseReviewStories({ ...input, until });
  if (picks.length === 0) return { status: 'no-news', day };

  const reports: SpendReport[] = [];
  let reply: ReviewReply | null;
  let error: string | null = null;
  try {
    reply = await ports.write(picks, (report) => reports.push(report));
  } catch (err) {
    reply = null;
    error = err instanceof Error ? err.message : String(err);
  }
  for (const report of reports) await ports.ledger(person.userId, report);

  if (!reply && !error) return { status: 'no-key', day };
  await ports.save({
    user_id: person.userId,
    day,
    overview: reply?.overview ?? null,
    items: reply ? picks.map((pick, i) => reviewItem(pick, reply.lines[i])) : [],
    written_at: now.toISOString(),
    error,
  });
  return error ? { status: 'failed', day, error } : { status: 'written', day, stories: picks.length };
}

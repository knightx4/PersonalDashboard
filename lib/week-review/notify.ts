import type { PushPayload } from '@/lib/push/send';
import type { WeekReviewRow } from './run';

/**
 * The phone notification for a stored weekly review (plan #1234).
 *
 * It goes through the same plumbing as the morning brief (lib/push/send.ts)
 * under its own tag, so on a Sunday the two arrive as separate notifications
 * and neither replaces the other. Pressing it opens the week's page.
 *
 * A week with no observations (a quiet week, stored as the plain version with
 * nothing in it) gets no notification: the page for it has nothing to show
 * that is worth a buzz on a Sunday morning. It returns null, and the row's
 * notified_at stays empty.
 */

export const WEEK_REVIEW_TAG = 'week-review';

/** Same cap as the brief's: far past a lock screen, well inside a push's 4 KB. */
const BODY_LIMIT = 1000;

export function weekReviewUrl(week: string): string {
  return `/home/week/${week}`;
}

export function weekReviewPayload(row: Pick<WeekReviewRow, 'week' | 'observations'>): PushPayload | null {
  const first = row.observations.find((item) => item.text.trim().length > 0)?.text.trim();
  if (!first) return null;
  return {
    title: 'Your week, from Dash',
    body: first.length > BODY_LIMIT ? `${first.slice(0, BODY_LIMIT - 1)}…` : first,
    url: weekReviewUrl(row.week),
    tag: WEEK_REVIEW_TAG,
  };
}

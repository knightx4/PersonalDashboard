import { requireUser } from '@/lib/auth/server';
import { formatClock } from '@/lib/clock';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { safeTimeZone } from '@/lib/core/timezone';
import { createNewsClient } from '@/lib/news/auth/server';
import { storyHref } from '@/lib/news/issues/list';
import {
  loadReview,
  loadReviewDays,
  readReviewDay,
  REVIEW_TIME,
  reviewDayLabel,
  reviewDayShort,
  reviewHref,
  reviewNav,
  todayStillToCome,
} from '@/lib/news/review/read';
import { reviewClock } from '@/lib/news/review/run';
import { ReviewView } from './review-view';

export const metadata = { title: 'Daily review' };
export const dynamic = 'force-dynamic';

/**
 * The Daily review tab (plan #1616, under #1612): the review Dash writes each
 * evening at 8pm (lib/news/review/run.ts), the latest first and any earlier
 * day by `?day=`. A day with no newsletters has no review, so the arrows skip
 * it. Each line opens its story's page with `from=review`, so that page's back
 * link returns here.
 */
export default async function DailyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const client = await createNewsClient();
  const [settings, days] = await Promise.all([loadAccountSettings(user.id), loadReviewDays(client)]);
  const timezone = safeTimeZone(settings.timezone);
  const now = new Date();

  const nav = reviewNav(days, readReviewDay(params.day));
  const review = nav.day ? await loadReview(client, nav.day) : null;
  const latest = days[0] ?? null;
  const evening = reviewClock(timezone, now);
  // Before 8pm the newest review is an earlier day's, so the page says when today's comes.
  const todayAt = !review || (nav.day === latest && todayStillToCome(timezone, now)) ? REVIEW_TIME : null;

  return (
    <ReviewView
      review={
        review && {
          dayLabel: reviewDayLabel(review.day, now),
          writtenAt: formatClock(review.writtenAt, { timeZone: timezone }),
          overview: review.overview,
          retrying: !review.overview && evening?.day === review.day,
          lines: review.items.map((item) => ({
            issueId: item.issue_id,
            storyIndex: item.story_index,
            href: `${storyHref(item.issue_id, item.story_index)}?from=review`,
            line: item.line,
            sources: item.sources,
            local: item.local === true,
          })),
        }
      }
      earlier={
        nav.earlier
          ? { href: reviewHref(nav.earlier, latest), label: reviewDayShort(nav.earlier) }
          : null
      }
      later={
        nav.later ? { href: reviewHref(nav.later, latest), label: reviewDayShort(nav.later) } : null
      }
      todayAt={todayAt}
    />
  );
}

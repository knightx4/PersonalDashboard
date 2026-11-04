import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { safeTimeZone } from '@/lib/core/timezone';
import { formatClock } from '@/lib/core/when';
import { loadWorkspaceInbox } from '@/lib/inbox/workspace-inbox';
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
import { NewsInboxFold, NewsReviewFold } from './now-fold-views';

/**
 * Inbox and the Daily review, folded into News's Now (plan #1496.10). Both
 * were tabs of their own; a month of opens showed them wanted as a glance
 * under the Quick read, so each is a fold there and the tabs are gone.
 *
 * The view components take plain props so the gallery draws them from
 * fixtures; the loaders below read the rows and place them in a Suspense so
 * the Quick read never waits on either.
 */

async function ReviewFoldLoader({ day }: { day?: string }) {
  const user = await requireUser();
  const client = await createNewsClient();
  const [settings, days] = await Promise.all([loadAccountSettings(user.id), loadReviewDays(client)]);
  const timezone = safeTimeZone(settings.timezone);
  const now = new Date();
  const nav = reviewNav(days, readReviewDay(day));
  const review = nav.day ? await loadReview(client, nav.day) : null;
  if (!review) return null;
  const latest = days[0] ?? null;
  const evening = reviewClock(timezone, now);
  // Before 8pm the newest review is an earlier day's, so say when today's comes.
  const todayAt = nav.day === latest && todayStillToCome(timezone, now) ? REVIEW_TIME : null;
  return (
    <div className="mt-6">
      <NewsReviewFold
        review={{
          dayLabel: reviewDayLabel(review.day, now),
          writtenAt: formatClock(review.writtenAt, { timeZone: timezone }),
          overview: review.overview,
          retrying: !review.overview && evening?.day === review.day,
          lines: review.items.map((item) => ({
            issueId: item.issue_id,
            storyIndex: item.story_index,
            href: storyHref(item.issue_id),
            line: item.line,
            sources: item.sources,
            local: item.local === true,
          })),
        }}
        earlier={nav.earlier ? { href: reviewHref(nav.earlier, latest), label: reviewDayShort(nav.earlier) } : null}
        later={nav.later ? { href: reviewHref(nav.later, latest), label: reviewDayShort(nav.later) } : null}
        todayAt={todayAt}
      />
    </div>
  );
}

async function InboxFoldLoader() {
  const user = await requireUser();
  const inbox = await loadWorkspaceInbox(user.id, 'news').catch(() => null);
  if (!inbox || inbox.rows.length === 0) return null;
  return (
    <div className="mt-6">
      <NewsInboxFold rows={inbox.rows} />
    </div>
  );
}

/** The two folds as Now places them: each streamed in its own Suspense. */
export function NewsNowFolds({ day }: { day?: string }) {
  return (
    <>
      <Suspense fallback={null}>
        <InboxFoldLoader />
      </Suspense>
      <Suspense fallback={null}>
        <ReviewFoldLoader day={day} />
      </Suspense>
    </>
  );
}

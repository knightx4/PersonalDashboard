import { PageHeader } from '@/components/shell/page-header';
import type { SearchSummary } from '@/lib/jobs/home/summary';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { ClosestApplication } from '@/lib/jobs/today/closest';
import type { TodayBoard } from '@/lib/jobs/today/load';
import type { ReviewPeek } from '@/lib/jobs/today/review-peek';
import { ClosestSection } from './closest-section';
import { LiveSection } from './live-section';
import { ReviewStrip } from './review-strip';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';
import { PageColumn } from '@/components/shell/page-width';

/**
 * Today, where Jobs opens (plan #1591), drawn from what the page has read.
 *
 * One column: the numbers that say where the search stands first (note
 * 9aab04c4), then in the order things need you: imports waiting to be checked
 * (when there are any), the applications closest to an offer (when there are
 * any), This week, then what came in since your last visit. It took in three tabs: Review is
 * the strip, Interviews' debrief nudge is in This week (or on the
 * application in Closest to an offer, when it is one), and Activity is behind "Since you last looked". Their pages keep their addresses.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage({
  review,
  closest,
  board,
  summary,
  since,
  timezone,
}: {
  review: ReviewPeek;
  closest: readonly ClosestApplication[];
  /** With the debriefs Closest to an offer asks for already taken out. */
  board: TodayBoard;
  summary: SearchSummary;
  since: SinceView;
  timezone: string;
}) {
  return (
    <PageColumn>
      <PageHeader title="Today" />
      <div className="space-y-8">
        <LiveSection summary={summary} />
        <ReviewStrip review={review} />
        <ClosestSection closest={closest} timezone={timezone} />
        <ThisWeekSection board={board} timezone={timezone} />
        <SinceList since={since} timezone={timezone} />
      </div>
    </PageColumn>
  );
}

import { PageHeader } from '@/components/shell/page-header';
import type { SearchSummary } from '@/lib/jobs/home/summary';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { TodayBoard } from '@/lib/jobs/today/load';
import type { LiveByMove } from '@/lib/jobs/today/live';
import type { ReviewPeek } from '@/lib/jobs/today/review-peek';
import { LiveSection } from './live-section';
import { ReviewStrip } from './review-strip';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';

/**
 * Today, where Jobs opens (plan #1591), drawn from what the page has read.
 *
 * One column, in the order things need you: imports waiting to be checked
 * (when there are any), then This week, then every live application grouped
 * by whose move it is, under the numbers that say where the search stands,
 * then what came in since your last visit. It took in three tabs: Review is
 * the strip, Interviews' debrief nudge is in This week, and Activity is
 * behind "Since you last looked". Their pages keep their addresses.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage({
  review,
  board,
  summary,
  live,
  since,
  timezone,
}: {
  review: ReviewPeek;
  board: TodayBoard;
  summary: SearchSummary;
  live: LiveByMove;
  since: SinceView;
  timezone: string;
}) {
  return (
    <>
      <PageHeader title="Today" />
      <div className="space-y-8">
        <ReviewStrip review={review} />
        <ThisWeekSection board={board} timezone={timezone} />
        <LiveSection summary={summary} live={live} />
        <SinceList since={since} timezone={timezone} />
      </div>
    </>
  );
}

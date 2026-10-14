import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import type { SearchSummary } from '@/lib/jobs/home/summary';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { ClosestApplication } from '@/lib/jobs/today/closest';
import type { TodayBoard } from '@/lib/jobs/today/load';
import type { LiveByMove } from '@/lib/jobs/today/live';
import { ClosestSection } from './closest-section';
import { LiveSection, SearchNumbers } from './live-section';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';

/**
 * Now, where Jobs opens (plan #1591, #1937.9), drawn from what the page has
 * read.
 *
 * What is going on, and nothing that asks for an action: what needs you is in
 * the Jobs Inbox (/jobs/inbox), which took the imports to check, the mail
 * waiting on a reply and the reminders when Today split in two (decision
 * #1937.3). Main plus rail: the applications closest to an offer, This week's
 * interviews and every live application by whose move it is in the column
 * you read; the numbers and what came in since your last visit in the rail
 * beside it.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage({
  closest,
  board,
  summary,
  live,
  since,
  timezone,
}: {
  closest: readonly ClosestApplication[];
  board: TodayBoard;
  summary: SearchSummary;
  live: LiveByMove;
  since: SinceView;
  timezone: string;
}) {
  return (
    <MainRail
      main={
        <>
          <PageHeader title="Now" />
          <div className="space-y-8">
            <ClosestSection closest={closest} timezone={timezone} />
            <ThisWeekSection board={board} timezone={timezone} />
            <LiveSection live={live} />
          </div>
        </>
      }
      rail={
        <>
          <SearchNumbers summary={summary} />
          <SinceList since={since} timezone={timezone} />
        </>
      }
    />
  );
}

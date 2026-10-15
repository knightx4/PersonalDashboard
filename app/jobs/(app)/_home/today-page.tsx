import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import type { SearchSummary } from '@/lib/jobs/home/summary';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { TodayBoard } from '@/lib/jobs/today/load';
import { LiveSection } from './live-section';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';

/**
 * Now, where Jobs opens (plan #1591, #1937.9): what is going on in the search,
 * and nothing that asks for an action. That is the Jobs Inbox's, a press away
 * in the column and the dock: the imports to check, mail waiting on a reply
 * and the reminders moved there when Today split in two (decision #1937.3).
 *
 * Main plus rail: the numbers that say where the search stands first (note
 * 9aab04c4), then This week, in the column, and what came in since your last
 * visit in the rail beside it from laptop width, under them on a phone. The
 * live applications are not listed by whose move it is: Pipeline lists them.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage({
  board,
  summary,
  since,
  timezone,
  dashToday,
}: {
  board: TodayBoard;
  summary: SearchSummary;
  since: SinceView;
  timezone: string;
  /** What Dash did today in Jobs, under Since you last looked in the rail (plan #1964.4). */
  dashToday?: React.ReactNode;
}) {
  return (
    <MainRail
      main={
        <>
          <PageHeader title="Now" />
          <div className="space-y-8">
            <LiveSection summary={summary} />
            <ThisWeekSection board={board} timezone={timezone} />
          </div>
        </>
      }
      rail={
        <>
          <SinceList since={since} timezone={timezone} />
          {dashToday}
        </>
      }
    />
  );
}

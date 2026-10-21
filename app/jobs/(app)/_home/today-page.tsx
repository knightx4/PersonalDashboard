import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import { PageWide } from '@/components/shell/page-width';
import type { FunnelView } from '@/lib/jobs/home/funnel';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { TodayBoard } from '@/lib/jobs/today/load';
import { Funnel } from './funnel';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';

/**
 * Now, where Jobs opens (plan #1591, #1937.9): what is going on in the search,
 * and nothing that asks for an action. That is the Jobs Inbox's, a press away
 * in the column and the dock: the imports to check, mail waiting on a reply
 * and the reminders moved there when Today split in two (decision #1937.3).
 *
 * The funnel first, across the page: every live role as a bead in its stage,
 * and what moved and what closed in the last 30 days (funnel.tsx). Then main
 * plus rail: This week in the column, and what came in since your last visit
 * in the rail beside it from laptop width, under it on a phone.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage({
  board,
  funnel,
  since,
  timezone,
  dashToday,
}: {
  board: TodayBoard;
  funnel: FunnelView;
  since: SinceView;
  timezone: string;
  /** What Dash did today in Jobs, under Since you last looked in the rail (plan #1964.4). */
  dashToday?: React.ReactNode;
}) {
  return (
    <div className="space-y-10">
      <PageWide>
        <PageHeader title="Now" />
        <Funnel view={funnel} />
      </PageWide>
      <MainRail
        main={<ThisWeekSection board={board} timezone={timezone} />}
        rail={
          <>
            <SinceList since={since} timezone={timezone} />
            {dashToday}
          </>
        }
      />
    </div>
  );
}

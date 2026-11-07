import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import { PageWide } from '@/components/shell/page-width';
import { ActivityFeed } from '@/components/jobs/activity/activity-feed';
import { CheckInboxNow, type CheckableAccount } from '@/components/jobs/activity/check-inbox-now';
import type { Activity } from '@/lib/jobs/activity/load';
import type { FunnelView } from '@/lib/jobs/home/funnel';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { TodayBoard } from '@/lib/jobs/today/load';
import { Funnel } from './funnel';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';

type TodayPageProps = {
  timezone: string;
  board: TodayBoard;
  funnel: FunnelView;
  since: SinceView;
  /** What Dash did today in Jobs, under Since you last looked in the rail (plan #1964.4). */
  dashToday?: React.ReactNode;
};

/**
 * Now, where Jobs opens (plan #1591, #1937.9): what is going on in the search,
 * and nothing that asks for an action. That is the Jobs Inbox's, a press away
 * in the column and the dock: the imports to check, mail waiting on a reply
 * and the reminders moved there when Today split in two (decision #1937.3).
 *
 * The funnel first, across the page: every live role as a bead in its stage,
 * and what moved and what closed in the last 30 days (funnel.tsx). Then main
 * plus rail: This week in the column, and what came in since your last visit
 * in the rail beside it from laptop width, under it on a phone. The whole feed
 * of what the syncs changed is Activity, a tab of its own again (note
 * eb898bfd), drawn by ActivityPage below.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage({ timezone, board, funnel, since, dashToday }: TodayPageProps) {
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

/**
 * Jobs' Activity tab (note eb898bfd): the whole feed of what the syncs
 * changed, with the button that checks the inbox now. It was a tab of Now
 * from plan #1496.7.2 until then. Here beside Now so the gallery draws both.
 */
export function ActivityPage({
  timezone,
  activity,
  accounts,
}: {
  timezone: string;
  activity: Activity;
  accounts: readonly CheckableAccount[];
}) {
  return (
    <PageWide>
      <PageHeader title="Activity" />
      <section aria-label="Activity">
        <CheckInboxNow accounts={accounts} />
        <ActivityFeed activity={activity} timezone={timezone} />
      </section>
    </PageWide>
  );
}

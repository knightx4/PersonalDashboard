import { MainRail } from '@/components/patterns/main-rail';
import { TabbedSections } from '@/components/patterns/tabbed-sections';
import { PageHeader } from '@/components/shell/page-header';
import { PageWide } from '@/components/shell/page-width';
import { ActivityFeed } from '@/components/jobs/activity/activity-feed';
import { CheckInboxNow, type CheckableAccount } from '@/components/jobs/activity/check-inbox-now';
import type { Activity } from '@/lib/jobs/activity/load';
import type { FunnelView } from '@/lib/jobs/home/funnel';
import { NOW_TAB_ADDRESS, NOW_TABS } from '@/lib/jobs/home/now-tabs';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { TodayBoard } from '@/lib/jobs/today/load';
import { Funnel } from './funnel';
import { SinceList } from './since-list';
import { ThisWeekSection } from './this-week-section';

type OverviewProps = {
  tab?: 'overview';
  board: TodayBoard;
  funnel: FunnelView;
  since: SinceView;
  /** What Dash did today in Jobs, under Since you last looked in the rail (plan #1964.4). */
  dashToday?: React.ReactNode;
};

type ActivityProps = {
  tab: 'activity';
  activity: Activity;
  accounts: readonly CheckableAccount[];
};

/**
 * Now, where Jobs opens (plan #1591, #1937.9): what is going on in the search,
 * and nothing that asks for an action. That is the Jobs Inbox's, a press away
 * in the column and the dock: the imports to check, mail waiting on a reply
 * and the reminders moved there when Today split in two (decision #1937.3).
 *
 * Two tabs under the header (plan #1496.7.2). Overview, which it opens on, has
 * the funnel first, across the page: every live role as a bead in its stage,
 * and what moved and what closed in the last 30 days (funnel.tsx). Then main
 * plus rail: This week in the column, and what came in since your last visit
 * in the rail beside it from laptop width, under it on a phone. Activity has
 * the whole feed of what the syncs changed, with the button that checks the
 * inbox now; it was its own page and tab until then. The page loads only the
 * open tab's rows.
 *
 * Here rather than in the page so the gallery can draw it from fixtures.
 */
export function TodayPage(
  props: {
    timezone: string;
    /** The gallery's: the tab the row marks open when the address names none. */
    opensOn?: 'overview' | 'activity';
  } & (OverviewProps | ActivityProps),
) {
  const { timezone, opensOn } = props;
  return (
    <div className="space-y-10">
      <PageWide>
        <PageHeader title="Now" />
        <TabbedSections tabs={NOW_TABS} label="Now" address={{ ...NOW_TAB_ADDRESS, opensOn }}>
          {props.tab === 'activity' ? (
            // As wide as the tab row above it, so the row and the feed share one column.
            <section id="activity" aria-label="Activity" className="scroll-mt-4">
              <CheckInboxNow accounts={props.accounts} />
              <ActivityFeed activity={props.activity} timezone={timezone} />
            </section>
          ) : (
            <Funnel view={props.funnel} />
          )}
        </TabbedSections>
      </PageWide>
      {props.tab !== 'activity' && (
        <MainRail
          main={<ThisWeekSection board={props.board} timezone={timezone} />}
          rail={
            <>
              <SinceList since={props.since} timezone={timezone} />
              {props.dashToday}
            </>
          }
        />
      )}
    </div>
  );
}

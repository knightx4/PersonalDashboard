import { PageHeader } from '@/components/shell/page-header';
import { ActivityFeed } from '@/components/jobs/activity/activity-feed';
import { CheckInboxNow, type CheckableAccount } from '@/components/jobs/activity/check-inbox-now';
import type { Activity } from '@/lib/jobs/activity/load';

/**
 * The Activity tab as it draws, from what its page read (plan #1601), so the
 * gallery draws it from fixtures.
 */
export function ActivityView({
  accounts,
  activity,
  timezone,
}: {
  accounts: CheckableAccount[];
  activity: Activity;
  timezone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Activity"
        description="What the syncs have actually changed. The inbox reads mail and opens or moves roles; the nightly sweep closes what has gone quiet and raises the nudges on This week."
      />
      <CheckInboxNow accounts={accounts} />
      <ActivityFeed activity={activity} timezone={timezone} />
    </div>
  );
}

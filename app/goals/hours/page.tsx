import { Clock } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { hoursPage } from '@/lib/goals/hours';
import { loadHoursMetrics } from '@/lib/goals/hours-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { HoursView } from './hours-view';

export const metadata = { title: 'Hours' };
export const dynamic = 'force-dynamic';

/**
 * Every hours metric across the goals on one page (migration goals 0089):
 * this week against each aim and the weekday pace, the last four weeks day by
 * day, how each has gone week by week, and each one's twelve-week chart. The
 * hours are logged from the capture box ("applied 2h, cleaned 1h") as
 * progress on a goal's steps; a goal's Hours logged metric is what puts it
 * here.
 */
export default async function HoursPage() {
  const user = await requireUser();
  const [account, client] = await Promise.all([loadAccountSettings(user.id), createGoalsClient()]);
  const today = todayIn(account.timezone);
  const metrics = await loadHoursMetrics(client);

  return (
    <PageColumn>
      <PageHeader
        title="Hours"
        description="The time you log on your goals, against each week's aim. Write it in the capture box on Now: applied 2h, cleaned 1.5h."
      />
      {metrics.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No hours tracked yet"
          description="Add a metric that counts Hours logged to a goal, and it shows here with the others."
        />
      ) : (
        <HoursView page={hoursPage(metrics, today)} />
      )}
    </PageColumn>
  );
}

import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { PageHeader } from '@/components/shell/page-header';
import { loadRecurringPayments } from '@/lib/recurring/load';
import { chargesNotInMail, loadRepeatingCharges } from '@/lib/finances/spending/load';
import { buildRecurringView } from '@/lib/recurring/view';
import { todayIn } from '@/lib/todo/tasks/model';
import { RecurringPaymentsView } from './recurring-view';
import { PageColumn } from '@/components/shell/page-width';

export const metadata = { title: 'Recurring' };

/**
 * What you pay for regularly, read from subscription and bill mail (plan
 * #1126), and charges that repeat on your accounts with no mail behind them
 * (plan #2593.7).
 */
export default async function RecurringPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [payments, settings, repeating] = await Promise.all([
    loadRecurringPayments(supabase, user.id),
    loadAccountSettings(user.id),
    loadRepeatingCharges(supabase, user.id),
  ]);
  const today = todayIn(settings.timezone);

  return (
    <PageColumn className="min-w-0">
      <PageHeader
        title="Recurring"
        description="Subscriptions and bills found in your mail and your accounts, with what they come to each month."
      />
      <RecurringPaymentsView
        view={buildRecurringView(payments, today)}
        today={today}
        repeating={chargesNotInMail(repeating, payments)}
      />
    </PageColumn>
  );
}

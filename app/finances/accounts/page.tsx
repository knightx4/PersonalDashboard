import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { netWorthSeries, summarize } from '@/lib/finances/accounts';
import { loadAccountsPage } from '@/lib/finances/accounts-store';
import { isPlaidConfigured } from '@/lib/finances/plaid/env';
import { todayIn } from '@/lib/todo/tasks/model';
import { AccountsView } from './accounts-view';

export const metadata = { title: 'Accounts' };

/** Every account they hold, grouped, with net worth over time (plan #2593.6). */
export default async function AccountsPage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
  const today = todayIn(settings.timezone);
  const data = await loadAccountsPage(await createClient(), user.id, today);
  const accounts = summarize(data.accounts, data.readings, data.holdings, today, data.comments);

  return (
    <AccountsView
      accounts={accounts}
      netWorth={netWorthSeries(data.accounts, data.readings, today)}
      today={today}
      configured={isPlaidConfigured()}
      failed={data.failed}
      needsSignIn={data.needsSignIn.map((link) => ({
        id: link.id,
        institutionId: link.institutionId,
        institutionName: link.institutionName,
        needsUpdate: true,
        lastError: null,
        linkedAt: link.lastSyncedAt ?? today,
        lastSyncedAt: link.lastSyncedAt,
        accounts: [],
      }))}
    />
  );
}

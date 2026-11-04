import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { toRef } from '@/lib/core/refs';
import { rowSubject } from '@/lib/core/subject';
import { summarize } from '@/lib/finances/accounts';
import { loadAccountPage } from '@/lib/finances/accounts-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { AccountView } from '../account-view';

export const metadata = { title: 'Account' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One account: its balance over time, recent transactions and holdings (plan
 * #2593.6). The id may also be a Goals loan record's, read as an account
 * (plan #2593.5).
 */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const settings = await loadAccountSettings(user.id);
  const today = todayIn(settings.timezone);
  const data = await loadAccountPage(await createClient(), user.id, id, today);
  if (!data) notFound();
  const [account] = summarize([data.account], data.readings, data.holdings, today);

  return (
    <AccountView
      account={account}
      readings={data.readings}
      holdings={data.holdings}
      transactions={data.transactions}
      moreTransactions={data.moreTransactions}
      thread={data.thread}
      today={today}
      goalId={data.goalId}
      // A Goals loan is no finances.accounts row; the view builds its path.
      subject={
        data.account.source === 'goals'
          ? undefined
          : await rowSubject(toRef('finances.accounts', id))
      }
    />
  );
}

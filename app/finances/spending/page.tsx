import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadPeople, parsePersonFilter } from '@/lib/people/load';
import { loadDashboard, parseDashboardRange } from '@/lib/dashboard/load';
import { loadTransactionSpending } from '@/lib/finances/spending/load';
import { tabFrom } from '@/lib/tabs';
import { NowDashToday } from '@/components/shell/dash-today-fold';
import { DashboardView } from './dashboard-view';
import { SPENDING_TABS, TransactionsSpendingView, type SpendingTab } from './transactions-view';

export const metadata = { title: 'Spending' };

/**
 * Spending from bank and card transactions once any checking, savings or
 * card account has one (plan #2593.7), and from Shopping's orders until then.
 *
 * Every figure comes from lib/money.ts or lib/finances/spending, which keep
 * its rules. Do not compute spend inline here.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; person?: string; tab?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const range = parseDashboardRange(params.range);

  const transactions = await loadTransactionSpending(supabase, user.id, range);
  if (transactions) {
    return (
      <TransactionsSpendingView
        range={range}
        tab={tabFrom(params.tab, SPENDING_TABS) as SpendingTab}
        data={transactions}
        dashToday={<NowDashToday workspace="finances" />}
      />
    );
  }

  const core = await createCoreClient();
  const people = await loadPeople(core, user.id);
  const personId = parsePersonFilter(params.person, people);
  const data = await loadDashboard(supabase, user.id, range, personId);

  return (
    <DashboardView
      range={range}
      personId={personId}
      people={people}
      data={data}
      dashToday={<NowDashToday workspace="shopping" />}
    />
  );
}

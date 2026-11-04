import { addDays } from '@/lib/finances/accounts';
import { loadAccountRows, readAllReadings } from '@/lib/finances/accounts-store';
import { PAIR_WINDOW_DAYS } from '@/lib/finances/spending/internal';
import { loadTransactions } from '@/lib/finances/spending/load';
import { buildMonthFacts, LOOKBACK_MONTHS, monthBefore, monthEnd, monthStart, type MonthFacts } from './facts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = import('@supabase/supabase-js').SupabaseClient<any, any, any>;

/**
 * Reads what the monthly money review is worked out from (plan #2593.8.2):
 * every account, hidden ones too since a payment into one still pairs with
 * its other half, a year of transactions before the month and a few days
 * past it for the pairing, and the balances from two months before it.
 *
 * Null when the person holds no accounts. Every read names the person, so a
 * service-role client stays in their account.
 */
export async function loadMonthFacts(client: Client, userId: string, month: string, today: string): Promise<MonthFacts | null> {
  const accounts = await loadAccountRows(client, userId, { hidden: true });
  if (accounts.length === 0) return null;
  const start = monthStart(month);
  const end = monthEnd(month);
  const [transactions, readings] = await Promise.all([
    loadTransactions(
      client,
      userId,
      addDays(monthStart(monthBefore(month, LOOKBACK_MONTHS)), -(PAIR_WINDOW_DAYS + 1)),
      addDays(end, PAIR_WINDOW_DAYS + 1),
    ),
    readAllReadings(client, userId, addDays(start, -62)),
  ]);
  return buildMonthFacts({ month, today, accounts, transactions, readings });
}

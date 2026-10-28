import type { SupabaseClient } from '@supabase/supabase-js';
import { FINANCES_SCHEMA } from '@/lib/finances/db/schema-name';
import { periodFor, recentMonthKeys, todayInTimezone, type PresetRange } from '@/lib/money';
import { matchInternal } from './internal';
import { summarizeTransactions, type RepeatingCharge, type TransactionSpending } from './model';
import { matchOrders, sameMerchant } from './orders';
import type { AccountKind, InternalKind, MatchOrder, SpendAccount, SpendTransaction } from './types';

/**
 * Reads Spending from finances.transactions (plan #2593.7). Null when no
 * checking, savings or card account has a transaction yet, so the page keeps
 * showing spending from orders until one is linked or imported.
 *
 * Thirteen months are read whatever the range: the year of months the chart
 * draws, and the one before it so a yearly charge can be seen repeating.
 */

const SPENDING_KINDS: readonly AccountKind[] = ['checking', 'savings', 'credit_card'];
const PAGE = 1000;

type AccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  hidden: boolean;
  mask: string | null;
};

type TransactionRow = {
  id: string;
  account_id: string;
  amount_cents: number;
  posted_on: string;
  description: string;
  merchant: string | null;
  category: string | null;
  category_detail: string | null;
  pending: boolean;
  order_id: string | null;
  recurring_payment_id: string | null;
  internal_kind: InternalKind | null;
};

type OrderRow = {
  id: string;
  order_date: string;
  total_cents: number;
  cancelled_at: string | null;
  merchants: { name: string } | { name: string }[] | null;
};

function toTransaction(row: TransactionRow): SpendTransaction {
  return {
    id: row.id,
    accountId: row.account_id,
    amountCents: Number(row.amount_cents),
    postedOn: row.posted_on,
    description: row.description,
    merchant: row.merchant,
    category: row.category,
    categoryDetail: row.category_detail,
    pending: row.pending,
    orderId: row.order_id,
    recurringPaymentId: row.recurring_payment_id,
    internalKind: row.internal_kind,
  };
}

async function loadTransactions(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string,
): Promise<SpendTransaction[]> {
  const db = supabase.schema(FINANCES_SCHEMA);
  const rows: TransactionRow[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db
      .from('transactions')
      .select(
        'id, account_id, amount_cents, posted_on, description, merchant, category, category_detail, pending, order_id, recurring_payment_id, internal_kind',
      )
      .eq('user_id', userId)
      .gte('posted_on', from)
      .lte('posted_on', to)
      .order('posted_on')
      .order('id')
      .range(start, start + PAGE - 1);
    if (error) throw new Error(`Could not read transactions: ${error.message}`);
    rows.push(...((data ?? []) as TransactionRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows.map(toTransaction);
}

async function loadAccounts(supabase: SupabaseClient, userId: string): Promise<SpendAccount[]> {
  const { data, error } = await supabase
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .select('id, name, kind, hidden, mask')
    .eq('user_id', userId);
  if (error) throw new Error(`Could not read accounts: ${error.message}`);
  return (data ?? []) as AccountRow[];
}

async function loadOrders(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string,
): Promise<MatchOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_date, total_cents, cancelled_at, merchants ( name )')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('order_date', from)
    .lte('order_date', to);
  if (error) throw new Error(`Could not read orders: ${error.message}`);
  return ((data ?? []) as OrderRow[]).map((row) => {
    const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
    return {
      id: row.id,
      orderDate: row.order_date,
      totalCents: Number(row.total_cents),
      merchantName: merchant?.name ?? null,
      cancelled: row.cancelled_at !== null,
    };
  });
}

async function loadTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return (data?.timezone as string | undefined) ?? 'UTC';
}

export async function loadTransactionSpending(
  supabase: SupabaseClient,
  userId: string,
  range: PresetRange,
): Promise<TransactionSpending | null> {
  const timezone = await loadTimezone(supabase, userId);
  const today = todayInTimezone(timezone);
  const period = periodFor(range, timezone);
  const from = `${recentMonthKeys(today, 13)[0]}-01`;
  const to = period.end > today ? period.end : today;

  // Every account is read, since a payment into a loan still pairs with its
  // half in checking; summarizeTransactions counts only checking, savings
  // and cards.
  const allAccounts = await loadAccounts(supabase, userId);
  const spendingAccounts = new Set(
    allAccounts.filter((a) => SPENDING_KINDS.includes(a.kind)).map((a) => a.id),
  );
  if (spendingAccounts.size === 0) return null;

  const [transactions, orders] = await Promise.all([
    loadTransactions(supabase, userId, from, to),
    loadOrders(supabase, userId, from, to),
  ]);
  if (!transactions.some((t) => spendingAccounts.has(t.accountId))) return null;

  const internal = matchInternal(transactions, allAccounts);
  const charges = transactions.filter((t) => t.amountCents < 0 && !internal.has(t.id));
  const orderFor = matchOrders(charges, orders);

  return summarizeTransactions({
    transactions,
    accounts: allAccounts,
    internal,
    orderFor,
    period,
    today,
  });
}

/**
 * Repeating charges for the Recurring page: those no recurring payment found
 * in mail already covers, by a charge naming it or by the payee's name.
 */
export function chargesNotInMail(
  repeating: readonly RepeatingCharge[],
  payees: readonly { id: string; payee: string }[],
): RepeatingCharge[] {
  const known = new Set(payees.map((p) => p.id));
  return repeating.filter(
    (r) =>
      !(r.recurringPaymentId && known.has(r.recurringPaymentId)) &&
      !payees.some((p) => sameMerchant(r.name, p.payee)),
  );
}

/** Repeating charges alone, for the Recurring page. Empty with no transactions. */
export async function loadRepeatingCharges(
  supabase: SupabaseClient,
  userId: string,
): Promise<RepeatingCharge[]> {
  const spending = await loadTransactionSpending(supabase, userId, 'this_month');
  return spending?.repeating ?? [];
}

import {
  KIND_LABEL,
  accountHref,
  accountTitle,
  addDays,
  daysBetween,
  isOwed,
  netWorthChange,
  netWorthNow,
  netWorthSeries,
  summarize,
  grouped,
  type AccountKind,
  type AccountRow,
  type AccountSummary,
  type NetWorthPoint,
} from '@/lib/finances/accounts';
import { loadAccountRows, loadAccountsPage, readAllReadings } from '@/lib/finances/accounts-store';
import { FINANCES_SCHEMA } from '@/lib/finances/db/schema-name';
import { PAIR_WINDOW_DAYS, matchInternal } from '@/lib/finances/spending/internal';
import { loadOrders, loadTransactions } from '@/lib/finances/spending/load';
import { categoryLabel, classify, merchantName, summarizeTransactions } from '@/lib/finances/spending/model';
import { matchOrders } from '@/lib/finances/spending/orders';
import type { SpendAccount, SpendTransaction } from '@/lib/finances/spending/types';
import { formatMoney } from '@/lib/money';
import {
  AskInputError,
  bareRef,
  isUuid,
  matchedNote,
  optionalDate,
  optionalString,
  type AskContext,
  type AskParent,
  type AskRow,
  type AskToolResult,
} from './db';

/**
 * Dash's Finances lookups (plan #2593.8.1): the accounts with their balances
 * and net worth, how a balance or net worth moved, and spending from bank and
 * card transactions.
 *
 * Every figure comes from the rules the Finances pages use (lib/finances), so
 * Dash and the page never disagree: a card or loan balance is what is owed and
 * net worth subtracts it, and spending goes through matchInternal and
 * summarizeTransactions, so a purchase on a card is counted once and the
 * payment from checking that clears it is left out. Summing amount_cents
 * directly would count it twice, which is why finances tables are not offered
 * to list_rows or query_rows.
 *
 * The reads go through the person's public client bound to the finances
 * schema, as the pages' do, filtered to their id.
 */

type Input = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = import('@supabase/supabase-js').SupabaseClient<any, any, any>;

/** Spending accounts: what Spending counts. */
const SPENDING_KINDS: readonly AccountKind[] = ['checking', 'savings', 'credit_card'];

/** The most charges and matched orders a spending answer lists. */
const MAX_CHARGES = 50;
const MAX_ORDERS = 20;
/** Longest period a spending question reads. */
const MAX_SPAN_DAYS = 731;

const usd = (cents: number) => formatMoney(cents, 'USD');

async function financesClient(ctx: AskContext): Promise<Client> {
  return (await ctx.db('public')) as unknown as Client;
}

function accountParent(account: Pick<AccountRow, 'id' | 'name' | 'mask'>): AskParent {
  return { table: 'finances.accounts', ref: account.id, title: accountTitle(account), href: accountHref(account.id) };
}

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

function payoffWords(summary: AccountSummary): string | null {
  const payoff = summary.payoff;
  if (!payoff) return null;
  if (payoff.kind === 'paid') return 'paid off';
  if (payoff.kind === 'never') return 'the payment does not cover the interest';
  return `paid off in ${payoff.month} (${payoff.months} payments)`;
}

function accountDetail(a: AccountSummary): Record<string, string | number | boolean | null> {
  const detail: Record<string, string | number | boolean | null> = {
    kind: KIND_LABEL[a.kind],
    institution: a.institutionName,
    balance: a.balanceCents === null ? null : usd(a.balanceCents),
    balance_is_owed: isOwed(a.kind),
    balance_on: a.readOn,
    stale: a.stale,
    from: a.source,
  };
  if (a.kind === 'credit_card') {
    detail.credit_limit = a.creditLimitCents === null ? null : usd(a.creditLimitCents);
    detail.limit_used = a.limitUsed === null ? null : `${Math.round(a.limitUsed * 100)}%`;
    detail.statement_balance = a.statementBalanceCents === null ? null : usd(a.statementBalanceCents);
  }
  if (a.kind === 'credit_card' || a.kind === 'loan') {
    detail.minimum_payment = a.minimumPaymentCents === null ? null : usd(a.minimumPaymentCents);
    detail.payment_due = a.nextPaymentDueOn;
    detail.interest_rate = a.interestRate === null ? null : `${a.interestRate}%`;
  }
  if (a.kind === 'loan') detail.payoff = payoffWords(a);
  if (a.investment) {
    detail.holdings_value = usd(a.investment.valueCents);
    detail.gain = a.investment.gainCents === null ? null : usd(a.investment.gainCents);
  }
  if (a.closedOn) detail.closed_on = a.closedOn;
  return detail;
}

export async function accountsLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const kind = optionalString(input, 'kind');
  if (kind && !(kind in KIND_LABEL)) throw new AskInputError(`kind must be one of ${Object.keys(KIND_LABEL).join(', ')}.`);
  const client = await financesClient(ctx);
  const page = await loadAccountsPage(client, ctx.userId, ctx.today);
  if (page.accounts.length === 0) {
    return {
      ok: true,
      rows: [],
      note: 'No accounts in Finances yet. They are linked through Plaid or imported on the Finances settings page.',
    };
  }

  const summaries = summarize(page.accounts, page.readings, page.holdings, ctx.today);
  const series = netWorthSeries(page.accounts, page.readings, ctx.today);
  const change = (days: number) => {
    const moved = netWorthChange(series, days);
    return moved ? { change: usd(moved.cents), since: moved.since } : null;
  };
  const shown = summaries.filter((a) => !kind || a.kind === kind);

  const rows: AskRow[] = shown.map((a) => ({
    table: 'finances.accounts',
    ref: a.id,
    title: accountTitle(a),
    href: accountHref(a.id),
    detail: accountDetail(a),
  }));

  const notes = [
    'A credit card or loan balance is the amount owed; net worth subtracts it.',
    'A linked account is read each morning; an imported one once a statement, so stale marks a balance older than that.',
  ];
  if (page.needsSignIn.length > 0) {
    notes.push(
      `${page.needsSignIn.map((l) => l.institutionName).join(', ')} needs signing in again on the Finances settings page; its balances have stopped updating.`,
    );
  }
  if (page.failed.length > 0) notes.push(`Reading ${page.failed.join(' and ')} failed, so those figures are missing.`);

  return {
    ok: true,
    rows,
    totals: {
      net_worth: usd(netWorthNow(summaries)),
      net_worth_change_30_days: change(30),
      net_worth_change_365_days: change(365),
      by_group: grouped(summaries).map((g) => ({ group: g.label, accounts: g.accounts.length, total: usd(g.totalCents) })),
    },
    note: notes.join(' '),
  };
}

// ---------------------------------------------------------------------------
// balance_history
// ---------------------------------------------------------------------------

/** Every point for a short period; otherwise the first and each month's last. */
export function samplePoints(points: readonly NetWorthPoint[]): NetWorthPoint[] {
  if (points.length <= 45) return [...points];
  const out: NetWorthPoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const next = points[i + 1];
    if (!next || next.day.slice(0, 7) !== points[i].day.slice(0, 7)) out.push(points[i]);
  }
  return out;
}

function resolveAccount<T extends AccountRow>(accounts: readonly T[], wanted: string): T {
  const ref = bareRef(wanted);
  if (isUuid(ref)) {
    const found = accounts.find((a) => a.id === ref);
    if (!found) throw new AskInputError('No account of theirs has that ref; call accounts for the refs.');
    return found;
  }
  const words = wanted.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = accounts.filter((a) => {
    const text = [a.name, a.officialName, a.institutionName, a.mask, KIND_LABEL[a.kind]].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new AskInputError(`No account matches "${wanted}"; call accounts for their names and refs.`);
  throw new AskInputError(
    `"${wanted}" matches ${matches.map((a) => accountTitle(a)).join(', ')}; pass one of their refs from accounts.`,
  );
}

export async function balanceHistoryLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const to = optionalDate(input, 'to') ?? ctx.today;
  const from = optionalDate(input, 'from') ?? addDays(to, -364);
  if (from > to) throw new AskInputError('from is after to.');
  if (daysBetween(from, to) > 365 * 5) throw new AskInputError('Ask for five years or less.');
  const wanted = optionalString(input, 'account');

  const client = await financesClient(ctx);
  const accounts = await loadAccountRows(client, ctx.userId, { hidden: true });
  const account = wanted ? resolveAccount(accounts, wanted) : null;
  const counted = account ? [account] : accounts.filter((a) => !a.hidden);
  if (counted.length === 0) {
    return { ok: true, rows: [], note: 'No accounts in Finances yet, so there is no balance history.' };
  }

  // Readings before `from` give each account its balance on the first day.
  const readings = await readAllReadings(client, ctx.userId, addDays(from, -62), account?.id);
  const days = daysBetween(from, to) + 1;
  const raw = netWorthSeries(counted, readings, to, days);
  // netWorthSeries counts an owed balance as negative; one account reads as its own balance.
  const points = account && isOwed(account.kind) ? raw.map((p) => ({ ...p, cents: -p.cents })) : raw;

  const rows: AskRow[] = counted
    .filter((a) => readings.some((r) => r.accountId === a.id))
    .map((a) => ({ table: 'finances.accounts', ref: a.id, title: accountTitle(a), href: accountHref(a.id) }));

  if (points.length === 0) {
    return { ok: true, rows, note: `No balances were read for ${account ? accountTitle(account) : 'their accounts'} by ${to}.` };
  }
  const first = points[0];
  const last = points[points.length - 1];
  const high = points.reduce((m, p) => (p.cents > m.cents ? p : m), first);
  const low = points.reduce((m, p) => (p.cents < m.cents ? p : m), first);
  const notes = [
    'A day with no reading carries the last balance before it.',
    account && isOwed(account.kind) ? 'This balance is the amount owed: a fall means less owed.' : null,
    first.day > from ? `Balances begin on ${first.day}.` : null,
  ].filter(Boolean);

  return {
    ok: true,
    rows,
    totals: {
      of: account ? accountTitle(account) : 'net worth',
      from: first.day,
      to: last.day,
      start: usd(first.cents),
      end: usd(last.cents),
      change: usd(last.cents - first.cents),
      highest: { day: high.day, balance: usd(high.cents) },
      lowest: { day: low.day, balance: usd(low.cents) },
      points: samplePoints(points).map((p) => ({ day: p.day, balance: usd(p.cents) })),
    },
    note: notes.join(' '),
  };
}

// ---------------------------------------------------------------------------
// spend_by_merchant, from transactions
// ---------------------------------------------------------------------------

async function earliestTransaction(client: Client, userId: string, accountIds: readonly string[]): Promise<string | null> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('transactions')
    .select('posted_on')
    .eq('user_id', userId)
    .in('account_id', [...accountIds])
    .order('posted_on')
    .limit(1);
  if (error) throw new Error(`transactions: ${error.message}`);
  return ((data ?? []) as { posted_on: string }[])[0]?.posted_on ?? null;
}

function matchesWords(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => lower.includes(w));
}

/**
 * Spending between two days from bank and card transactions, or null when
 * the person has no transaction on a checking, savings or card account, so
 * the caller can answer from orders instead.
 */
export async function transactionSpendLookup(ctx: AskContext, input: Input): Promise<AskToolResult | null> {
  const from = optionalDate(input, 'from');
  const to = optionalDate(input, 'to') ?? ctx.today;
  if (!from) throw new AskInputError('from is required.');
  if (from > to) throw new AskInputError('from is after to.');
  if (daysBetween(from, to) > MAX_SPAN_DAYS) throw new AskInputError('Ask for two years or less at a time.');
  const merchantQuery = optionalString(input, 'merchant');
  const categoryQuery = optionalString(input, 'category');
  const accountQuery = optionalString(input, 'account');

  const client = await financesClient(ctx);
  const rows = await loadAccountRows(client, ctx.userId, { hidden: true });
  const accounts: SpendAccount[] = rows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, hidden: a.hidden, mask: a.mask }));
  const spendingIds = accounts.filter((a) => SPENDING_KINDS.includes(a.kind)).map((a) => a.id);
  if (spendingIds.length === 0) return null;
  const earliest = await earliestTransaction(client, ctx.userId, spendingIds);
  if (!earliest) return null;

  const account = accountQuery ? resolveAccount(rows, accountQuery) : null;

  // A few days either side, so a payment whose other half falls just outside
  // the period still pairs and is left out.
  const transactions = await loadTransactions(
    client,
    ctx.userId,
    addDays(from, -(PAIR_WINDOW_DAYS + 1)),
    addDays(to, PAIR_WINDOW_DAYS + 1),
  );
  const internal = matchInternal(transactions, accounts);
  const wanted = transactions.filter(
    (t) =>
      (!account || t.accountId === account.id) &&
      (!merchantQuery || matchesWords(`${merchantName(t)} ${t.description}`, merchantQuery)) &&
      (!categoryQuery || matchesWords(`${categoryLabel(t.category)} ${t.category ?? ''} ${t.categoryDetail ?? ''}`, categoryQuery)),
  );

  let orderFor = new Map<string, string>();
  if (ctx.enabledModules.includes('shopping')) {
    try {
      const orders = await loadOrders(client, ctx.userId, addDays(from, -10), to);
      orderFor = matchOrders(
        wanted.filter((t) => t.amountCents < 0 && !internal.has(t.id)),
        orders,
      );
    } catch (error) {
      console.error('spend_by_merchant: reading orders failed', error);
    }
  }

  const period = { start: from, end: to };
  const summary = summarizeTransactions({ transactions: wanted, accounts, internal, orderFor, period, today: to });

  // By month, over the period only: charges less refunds in the month they landed.
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byMonth = new Map<string, number>();
  let pending = 0;
  const counted: SpendTransaction[] = [];
  for (const t of wanted) {
    if (t.postedOn < from || t.postedOn > to) continue;
    if (t.pending) pending += 1;
    const flow = classify(t, byId.get(t.accountId), internal);
    if (flow !== 'spend' && flow !== 'refund') continue;
    counted.push(t);
    const month = t.postedOn.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) - t.amountCents);
  }
  const monthsOf = (ids: ReadonlySet<string>) => {
    const m = new Map<string, number>();
    for (const t of counted) if (ids.has(t.id)) m.set(t.postedOn.slice(0, 7), (m.get(t.postedOn.slice(0, 7)) ?? 0) - t.amountCents);
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([month, cents]) => ({ month, spent: usd(cents) }));
  };

  const accountOf = new Map(rows.map((a) => [a.id, a]));
  const listed = [...counted].sort((a, b) => b.postedOn.localeCompare(a.postedOn) || a.amountCents - b.amountCents);
  const out: AskRow[] = listed.slice(0, MAX_CHARGES).map((t) => {
    const owner = accountOf.get(t.accountId)!;
    return {
      table: 'finances.transactions',
      ref: t.id,
      title: merchantName(t),
      href: accountHref(t.accountId),
      detail: {
        date: t.postedOn,
        [t.amountCents < 0 ? 'spent' : 'refunded']: usd(Math.abs(t.amountCents)),
        account: accountTitle(owner),
        category: categoryLabel(t.category),
      },
      parent: accountParent(owner),
    };
  });
  const orderIds = [...new Set(listed.map((t) => orderFor.get(t.id)).filter((id): id is string => !!id))];
  for (const id of orderIds.slice(0, MAX_ORDERS)) {
    const charge = listed.find((t) => orderFor.get(t.id) === id)!;
    out.push({
      table: 'public.orders',
      ref: id,
      title: `${merchantName(charge)} order`,
      href: `/shopping/orders/${id}`,
      detail: { charged_on: charge.postedOn, charge: usd(-charge.amountCents) },
    });
  }

  const notes = [
    'From bank and card transactions. Card payments and transfers between their own accounts are left out, so a purchase is counted once, on the card.',
    'Spent is charges less refunds, and a refund counts in the month it landed.',
    matchedNote(listed.length, Math.min(listed.length, MAX_CHARGES)),
    earliest > from ? `Their transactions begin on ${earliest}, so nothing before then is counted.` : null,
    pending > 0 ? `${pending} pending transaction${pending === 1 ? ' is' : 's are'} left out until ${pending === 1 ? 'it posts' : 'they post'}.` : null,
  ].filter(Boolean);

  return {
    ok: true,
    rows: out,
    totals: {
      source: 'bank and card transactions',
      period: { from, to },
      spent: usd(summary.spentCents),
      charges: summary.chargeCount,
      refunds: usd(summary.refundCents),
      money_in: usd(summary.inCents),
      left_out_card_payments_and_transfers: { amount: usd(summary.internalCents), count: summary.internalCount },
      by_month: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, cents]) => ({ month, spent: usd(cents) })),
      by_category: summary.categories.slice(0, 15).map((c) => ({ category: c.label, spent: usd(c.cents) })),
      by_merchant: summary.merchants.slice(0, 20).map((m) => ({
        merchant: m.name,
        spent: usd(m.cents),
        charges: m.charges.filter((c) => c.cents > 0).length,
        by_month: monthsOf(new Set(m.charges.map((c) => c.id))),
      })),
      orders_matched: orderIds.length,
    },
    note: notes.join(' '),
  };
}

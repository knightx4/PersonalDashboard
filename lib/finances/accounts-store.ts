import type { DevComment } from '@/lib/comments/load';
import { loadThread, loadThreads } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import {
  addDays,
  NET_WORTH_DAYS,
  type AccountKind,
  type AccountRow,
  type AccountSource,
  type Holding,
  type Reading,
} from './accounts';
import { FINANCES_SCHEMA } from './db/schema-name';

/**
 * Reading the Accounts page's rows (plan #2593.6). Every read names the
 * person, so a service-role client stays in their account too.
 *
 * Kept free of server-only imports so it can be called with any client.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = import('@supabase/supabase-js').SupabaseClient<any, any, any>;

const ACCOUNT_COLUMNS =
  'id, name, official_name, institution_name, mask, kind, source, link_id, credit_limit_cents, interest_rate, ' +
  'minimum_payment_cents, next_payment_due_on, statement_balance_cents, closed_on';

type AccountRecord = {
  id: string;
  name: string;
  official_name: string | null;
  institution_name: string | null;
  mask: string | null;
  kind: AccountKind;
  source: AccountSource;
  link_id: string | null;
  credit_limit_cents: number | string | null;
  interest_rate: number | string | null;
  minimum_payment_cents: number | string | null;
  next_payment_due_on: string | null;
  statement_balance_cents: number | string | null;
  closed_on: string | null;
};

/** bigint and numeric columns come back as strings past 2^53 or always; cents fit a number. */
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

function toAccount(row: AccountRecord): AccountRow {
  return {
    id: row.id,
    name: row.name,
    officialName: row.official_name,
    institutionName: row.institution_name,
    mask: row.mask,
    kind: row.kind,
    source: row.source,
    linkId: row.link_id,
    creditLimitCents: num(row.credit_limit_cents),
    interestRate: num(row.interest_rate),
    minimumPaymentCents: num(row.minimum_payment_cents),
    nextPaymentDueOn: row.next_payment_due_on,
    statementBalanceCents: num(row.statement_balance_cents),
    closedOn: row.closed_on,
  };
}

/** Rows per request: PostgREST's own cap. */
const PAGE = 1000;

export async function readAllReadings(
  client: Client,
  userId: string,
  since: string,
  accountId?: string,
): Promise<Reading[]> {
  const out: Reading[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client
      .schema(FINANCES_SCHEMA)
      .from('balance_readings')
      .select('account_id, read_on, balance_cents')
      .eq('user_id', userId)
      .gte('read_on', since);
    if (accountId) query = query.eq('account_id', accountId);
    const { data, error } = await query
      .order('read_on')
      .order('account_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading balances failed: ${error.message}`);
    const rows = (data ?? []) as {
      account_id: string;
      read_on: string;
      balance_cents: number | string;
    }[];
    for (const r of rows)
      out.push({
        accountId: r.account_id,
        readOn: r.read_on,
        balanceCents: Number(r.balance_cents),
      });
    if (rows.length < PAGE) return out;
  }
}

/** The holdings snapshots this far back are read; the newest per account is what shows. */
const HOLDINGS_DAYS = 120;

async function readHoldings(
  client: Client,
  userId: string,
  today: string,
  accountId?: string,
): Promise<Holding[]> {
  let query = client
    .schema(FINANCES_SCHEMA)
    .from('holdings')
    .select('account_id, security_name, ticker, quantity, value_cents, cost_basis_cents, as_of')
    .eq('user_id', userId)
    .gte('as_of', addDays(today, -HOLDINGS_DAYS));
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query.order('as_of', { ascending: false }).limit(PAGE);
  if (error) throw new Error(`Reading holdings failed: ${error.message}`);
  return (
    (data ?? []) as {
      account_id: string;
      security_name: string;
      ticker: string | null;
      quantity: number | string;
      value_cents: number | string;
      cost_basis_cents: number | string | null;
      as_of: string;
    }[]
  ).map((h) => ({
    accountId: h.account_id,
    securityName: h.security_name,
    ticker: h.ticker,
    quantity: Number(h.quantity),
    valueCents: Number(h.value_cents),
    costBasisCents: num(h.cost_basis_cents),
    asOf: h.as_of,
  }));
}

/** Every account the person holds, hidden ones included when asked, by name. */
export async function loadAccountRows(
  client: Client,
  userId: string,
  options: { hidden?: boolean } = {},
): Promise<(AccountRow & { hidden: boolean })[]> {
  let query = client
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .select(`${ACCOUNT_COLUMNS}, hidden`)
    .eq('user_id', userId);
  if (!options.hidden) query = query.eq('hidden', false);
  const { data, error } = await query.order('name');
  if (error) throw new Error(`Reading accounts failed: ${error.message}`);
  return ((data ?? []) as unknown as (AccountRecord & { hidden: boolean })[]).map((row) => ({
    ...toAccount(row),
    hidden: row.hidden,
  }));
}

/** A Plaid link that has to be signed in again, for the banner. */
export type LinkNeedingSignIn = {
  id: string;
  institutionId: string | null;
  institutionName: string;
  lastSyncedAt: string | null;
};

async function readLinksNeedingSignIn(
  client: Client,
  userId: string,
): Promise<LinkNeedingSignIn[]> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('links')
    .select('id, institution_id, institution_name, last_synced_at')
    .eq('user_id', userId)
    .eq('needs_update', true)
    .neq('status', 'removed')
    .order('institution_name');
  if (error) throw new Error(`Reading linked institutions failed: ${error.message}`);
  return (
    (data ?? []) as {
      id: string;
      institution_id: string | null;
      institution_name: string;
      last_synced_at: string | null;
    }[]
  ).map((l) => ({
    id: l.id,
    institutionId: l.institution_id,
    institutionName: l.institution_name,
    lastSyncedAt: l.last_synced_at,
  }));
}

export type AccountsPageData = {
  accounts: AccountRow[];
  readings: Reading[];
  holdings: Holding[];
  comments: Map<string, number>;
  needsSignIn: LinkNeedingSignIn[];
  /** The reads behind the accounts that failed, so the page says what is missing. */
  failed: AccountsRead[];
};

/** A read the Accounts page can draw without: balances, holdings, sign-ins. */
export type AccountsRead = 'balances' | 'holdings' | 'sign-ins';

/**
 * Everything the Accounts page draws: the accounts not hidden, a year of
 * readings and two months before it (so a balance read once a statement has
 * a value on the chart's first day), the newest holdings, how many comments
 * each account carries, and the links asking for a new sign-in.
 */
export async function loadAccountsPage(
  client: Client,
  userId: string,
  today: string,
): Promise<AccountsPageData> {
  const { data, error } = await client
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .eq('hidden', false)
    .order('name');
  if (error) throw new Error(`Reading accounts failed: ${error.message}`);
  const accounts = ((data ?? []) as unknown as AccountRecord[]).map(toAccount);

  // The accounts themselves are the page; a failure to read them is the
  // route's error page. Each read behind them fails on its own and is named
  // on the page, which still lists what did load.
  const failed: AccountsRead[] = [];
  const orNothing =
    <T>(read: AccountsRead, empty: T) =>
    (error: unknown): T => {
      console.error(`Accounts: reading ${read} failed`, error);
      failed.push(read);
      return empty;
    };
  const [readings, holdings, needsSignIn, threads] = await Promise.all([
    readAllReadings(client, userId, addDays(today, -(NET_WORTH_DAYS + 60))).catch(
      orNothing('balances', [] as Reading[]),
    ),
    readHoldings(client, userId, today).catch(orNothing('holdings', [] as Holding[])),
    readLinksNeedingSignIn(client, userId).catch(orNothing('sign-ins', [] as LinkNeedingSignIn[])),
    // A failed read leaves the counts off rather than the page broken.
    loadThreads(
      client,
      accounts.map((a) => threadRef('account', a.id)),
      { userId },
    ).catch(() => new Map<string, DevComment[]>()),
  ]);

  const comments = new Map<string, number>();
  for (const a of accounts) {
    const count = threads.get(threadRef('account', a.id))?.length ?? 0;
    if (count > 0) comments.set(a.id, count);
  }
  return { accounts, readings, holdings, comments, needsSignIn, failed };
}

/** One transaction as the account page lists it. */
export type AccountTransaction = {
  id: string;
  postedOn: string;
  description: string;
  merchant: string | null;
  category: string | null;
  amountCents: number;
  pending: boolean;
};

/** Transactions an account's page lists, newest first. */
export const RECENT_TRANSACTIONS = 30;

export type AccountPageData = {
  account: AccountRow;
  readings: Reading[];
  holdings: Holding[];
  transactions: AccountTransaction[];
  /** Whether more transactions exist than are listed. */
  moreTransactions: boolean;
  link: { institutionName: string; needsUpdate: boolean; lastSyncedAt: string | null } | null;
  thread: DevComment[];
};

/** One account's page, or null when it is not theirs or not there. */
export async function loadAccountPage(
  client: Client,
  userId: string,
  id: string,
  today: string,
): Promise<AccountPageData | null> {
  const db = client.schema(FINANCES_SCHEMA);
  const { data, error } = await db
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Reading the account failed: ${error.message}`);
  if (!data) return null;
  const account = toAccount(data as unknown as AccountRecord);

  const [readings, holdings, transactions, link, thread] = await Promise.all([
    readAllReadings(client, userId, addDays(today, -(NET_WORTH_DAYS * 5)), id),
    account.kind === 'brokerage' ? readHoldings(client, userId, today, id) : Promise.resolve([]),
    db
      .from('transactions')
      .select('id, posted_on, description, merchant, category, amount_cents, pending')
      .eq('user_id', userId)
      .eq('account_id', id)
      .order('posted_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(RECENT_TRANSACTIONS + 1)
      .then(({ data: rows, error: failed }) => {
        if (failed) throw new Error(`Reading transactions failed: ${failed.message}`);
        return (
          (rows ?? []) as {
            id: string;
            posted_on: string;
            description: string;
            merchant: string | null;
            category: string | null;
            amount_cents: number | string;
            pending: boolean;
          }[]
        ).map((t) => ({
          id: t.id,
          postedOn: t.posted_on,
          description: t.description,
          merchant: t.merchant,
          category: t.category,
          amountCents: Number(t.amount_cents),
          pending: t.pending,
        }));
      }),
    account.linkId
      ? db
          .from('links')
          .select('institution_name, needs_update, last_synced_at')
          .eq('user_id', userId)
          .eq('id', account.linkId)
          .maybeSingle()
          .then(({ data: row }) =>
            row
              ? {
                  institutionName: (row as { institution_name: string }).institution_name,
                  needsUpdate: (row as { needs_update: boolean }).needs_update,
                  lastSyncedAt: (row as { last_synced_at: string | null }).last_synced_at,
                }
              : null,
          )
      : Promise.resolve(null),
    loadThread(client, threadRef('account', id), { userId }).catch(() => [] as DevComment[]),
  ]);

  return {
    account,
    readings,
    holdings,
    transactions: transactions.slice(0, RECENT_TRANSACTIONS),
    moreTransactions: transactions.length > RECENT_TRANSACTIONS,
    link,
    thread,
  };
}

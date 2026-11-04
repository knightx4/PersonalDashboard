import { accountRows, toCents, type AccountKind, type AccountRow, type BalanceRow, type PlaidAccount } from './link';

/**
 * Keeping a linked institution current (plan #2593.4), with Plaid and the
 * database passed in so the rules can be tested over recorded responses.
 *
 * One run of one link, every morning and whenever Plaid's webhook says
 * something changed:
 *
 *   1. /accounts/get     each account, and a balance reading dated today.
 *   2. /transactions/sync from the stored cursor: adds, changes and removals.
 *                        A posted transaction takes over the row of the
 *                        pending one it replaces, so an order or recurring
 *                        payment tied to the pending charge stays tied.
 *   3. /liabilities/get  statement balance, minimum payment, due date and
 *                        rate for each card and student loan.
 *   4. /investments/holdings/get  what each brokerage account holds today.
 *
 * Each product is asked for only when the link holds an account it applies
 * to: calling an optional product Plaid has not started yet starts it.
 *
 * A login Plaid says has to be repeated marks the link needing attention,
 * which puts Fix sign-in on its row in Finances settings. Any failure starts
 * or continues the link's failing streak, and on its third day the run files
 * one Dev note.
 */

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name?: string | null;
  original_description?: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
};

export type SyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
};

export type PlaidCardLiability = {
  account_id: string | null;
  aprs: { apr_percentage: number; apr_type: string }[];
  last_statement_balance: number | null;
  last_statement_issue_date: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
};

export type PlaidStudentLoan = {
  account_id: string | null;
  interest_rate_percentage: number | null;
  last_statement_balance?: number | null;
  last_statement_issue_date: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
};

export type PlaidHoldings = {
  holdings: {
    account_id: string;
    security_id: string;
    quantity: number;
    institution_value: number;
    cost_basis: number | null;
  }[];
  securities: { security_id: string; name: string | null; ticker_symbol: string | null }[];
};

/** The Plaid calls a sync makes. lib/finances/plaid/client.ts wraps the real ones. */
export interface SyncPlaidPort {
  getAccounts(accessToken: string): Promise<PlaidAccount[]>;
  transactionsSync(accessToken: string, cursor: string | null): Promise<SyncPage>;
  getLiabilities(accessToken: string): Promise<{ credit: PlaidCardLiability[]; student: PlaidStudentLoan[] }>;
  getHoldings(accessToken: string): Promise<PlaidHoldings>;
}

export type SyncLink = {
  id: string;
  user_id: string;
  institution_name: string;
  access_token: string;
  sync_cursor: string | null;
  needs_update: boolean;
  failing_since: string | null;
  failure_noted_on: string | null;
};

export type TransactionRow = {
  user_id: string;
  account_id: string;
  plaid_transaction_id: string;
  amount_cents: number;
  posted_on: string;
  authorized_on: string | null;
  description: string;
  merchant: string | null;
  category: string | null;
  category_detail: string | null;
  pending: boolean;
};

export type AccountDetails = {
  interest_rate: number | null;
  minimum_payment_cents: number | null;
  next_payment_due_on: string | null;
  statement_balance_cents: number | null;
  last_statement_on: string | null;
};

export type HoldingRow = {
  user_id: string;
  account_id: string;
  security_id: string;
  ticker: string | null;
  security_name: string;
  quantity: number;
  value_cents: number;
  cost_basis_cents: number | null;
  as_of: string;
};

export type LinkPatch = {
  sync_cursor?: string;
  last_synced_at?: string;
  needs_update?: boolean;
  status?: 'active' | 'error';
  last_error?: string | null;
  failing_since?: string | null;
  failure_noted_on?: string | null;
};

/** The database writes a sync makes. lib/finances/plaid/store.ts writes them through the service role. */
export interface SyncStore {
  saveAccounts(userId: string, accounts: AccountRow[], balances: BalanceRow[]): Promise<number>;
  /** The link's accounts by Plaid's account_id. */
  accountIds(userId: string, linkId: string): Promise<Map<string, { id: string; kind: AccountKind }>>;
  /** Which of these Plaid transaction ids already have a row. */
  existingTransactions(userId: string, plaidIds: string[]): Promise<Set<string>>;
  /** Moves a row from one Plaid transaction id to another: a pending charge that posted. */
  renameTransaction(userId: string, fromPlaidId: string, toPlaidId: string): Promise<void>;
  upsertTransactions(rows: TransactionRow[]): Promise<void>;
  deleteTransactions(userId: string, plaidIds: string[]): Promise<void>;
  updateAccountDetails(userId: string, accountId: string, details: AccountDetails): Promise<void>;
  upsertHoldings(rows: HoldingRow[]): Promise<void>;
  updateLink(userId: string, linkId: string, patch: LinkPatch): Promise<void>;
  /** Sets handled_at on the link's webhook events received up to `upTo`. */
  markEventsHandled(userId: string, linkId: string, upTo: string): Promise<void>;
  /** Files a bug in the Dev notes queue; returns its id. */
  writeDevNote(userId: string, body: string): Promise<string>;
}

export type SyncDeps = {
  plaid: SyncPlaidPort;
  store: SyncStore;
  decrypt: (cipher: string) => string;
};

export type SyncResult =
  | {
      ok: true;
      accounts: number;
      added: number;
      modified: number;
      removed: number;
      posted: number;
      cards: number;
      loans: number;
      holdings: number;
    }
  | { ok: false; error: string; code: string | null; needsUpdate: boolean; noteId: string | null };

/** Plaid error codes that mean the person has to sign in again through Link. */
export const LOGIN_ERRORS = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
  'ACCESS_NOT_GRANTED',
  'INSUFFICIENT_CREDENTIALS',
  'INVALID_CREDENTIALS',
  'INVALID_MFA',
  'ITEM_LOCKED',
  'USER_SETUP_REQUIRED',
  'MFA_NOT_SUPPORTED',
]);

/** Errors that mean a product does not apply to this Item: skipped, not a failure. */
export const NOT_APPLICABLE = new Set([
  'PRODUCTS_NOT_SUPPORTED',
  'PRODUCT_NOT_ENABLED',
  'NO_LIABILITY_ACCOUNTS',
  'NO_INVESTMENT_ACCOUNTS',
  'NO_INVESTMENT_AUTH_ACCOUNTS',
  'NO_ACCOUNTS',
]);

/** A failing streak this many days long files the Dev note. */
export const FAILING_DAYS_FOR_NOTE = 3;

/** How many times a sync restarts when Plaid says the data moved under it. */
const MAX_SYNC_RESTARTS = 3;

/** Plaid's error code on a failed call, read from the SDK's axios error. */
export function plaidErrorCode(error: unknown): string | null {
  const data = (error as { response?: { data?: { error_code?: unknown } } })?.response?.data;
  return typeof data?.error_code === 'string' ? data.error_code : null;
}

function plaidMessage(error: unknown): string {
  const data = (error as { response?: { data?: { display_message?: string | null; error_message?: string } } })
    ?.response?.data;
  if (data?.display_message) return data.display_message;
  if (data?.error_message) return data.error_message;
  const code = plaidErrorCode(error);
  if (code) return `Plaid refused: ${code}.`;
  return error instanceof Error ? error.message : 'Plaid could not be reached.';
}

/** Days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Every page from the cursor on, restarting from it when Plaid's data moves mid-way. */
export async function pullTransactions(
  plaid: SyncPlaidPort,
  accessToken: string,
  cursor: string | null,
): Promise<{ added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: string[]; cursor: string }> {
  for (let attempt = 0; ; attempt++) {
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let next = cursor;
    try {
      for (;;) {
        const page = await plaid.transactionsSync(accessToken, next);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed.map((r) => r.transaction_id));
        next = page.next_cursor;
        if (!page.has_more) break;
      }
      return { added, modified, removed, cursor: next ?? '' };
    } catch (error) {
      if (plaidErrorCode(error) === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < MAX_SYNC_RESTARTS) {
        continue;
      }
      throw error;
    }
  }
}

/** A Plaid transaction as a row. Plaid's amount is positive for money out; ours is the opposite. */
export function transactionRow(t: PlaidTransaction, userId: string, accountId: string): TransactionRow {
  const description = (t.name?.trim() || t.original_description?.trim() || t.merchant_name?.trim() || 'Transaction');
  const merchant = t.merchant_name?.trim() || null;
  return {
    user_id: userId,
    account_id: accountId,
    plaid_transaction_id: t.transaction_id,
    amount_cents: -(toCents(t.amount) ?? 0),
    posted_on: t.date,
    authorized_on: t.authorized_date ?? null,
    description,
    merchant,
    category: t.personal_finance_category?.primary ?? null,
    category_detail: t.personal_finance_category?.detailed ?? null,
    pending: t.pending,
  };
}

/**
 * Writes one pull of /transactions/sync.
 *
 * A posted transaction names the pending one it replaces. When that pending
 * row is here and the posted one is not, the row is moved to the posted id
 * before the upsert, so its id and anything tied to it are kept; when both
 * are here, the pending row goes. Plaid also lists the pending id under
 * removed, which then finds nothing to remove.
 */
export async function applyTransactions(
  store: SyncStore,
  userId: string,
  accounts: Map<string, { id: string }>,
  pull: { added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: string[] },
): Promise<{ added: number; modified: number; removed: number; posted: number }> {
  const removed = new Set(pull.removed);

  // Last word wins for a transaction listed twice across pages.
  const latest = new Map<string, PlaidTransaction>();
  for (const t of [...pull.added, ...pull.modified]) latest.set(t.transaction_id, t);

  const replacing = [...latest.values()].filter((t) => t.pending_transaction_id && !removed.has(t.transaction_id));
  const asked = replacing.flatMap((t) => [t.transaction_id, t.pending_transaction_id!]);
  const existing = asked.length ? await store.existingTransactions(userId, asked) : new Set<string>();

  let posted = 0;
  const stale: string[] = [];
  for (const t of replacing) {
    const pendingId = t.pending_transaction_id!;
    if (!existing.has(pendingId)) continue;
    if (existing.has(t.transaction_id)) {
      stale.push(pendingId);
    } else {
      await store.renameTransaction(userId, pendingId, t.transaction_id);
      existing.add(t.transaction_id);
      existing.delete(pendingId);
    }
    posted++;
  }

  const rows = [...latest.values()].flatMap((t) => {
    if (removed.has(t.transaction_id)) return [];
    const account = accounts.get(t.account_id);
    return account ? [transactionRow(t, userId, account.id)] : [];
  });
  if (rows.length) await store.upsertTransactions(rows);

  const gone = [...new Set([...removed, ...stale])];
  if (gone.length) await store.deleteTransactions(userId, gone);

  return { added: pull.added.length, modified: pull.modified.length, removed: pull.removed.length, posted };
}

export function cardDetails(card: PlaidCardLiability): AccountDetails {
  const apr = card.aprs.find((a) => a.apr_type === 'purchase_apr') ?? card.aprs[0];
  return {
    interest_rate: apr ? clampRate(apr.apr_percentage) : null,
    minimum_payment_cents: nonNegative(toCents(card.minimum_payment_amount)),
    next_payment_due_on: card.next_payment_due_date,
    statement_balance_cents: toCents(card.last_statement_balance),
    last_statement_on: card.last_statement_issue_date,
  };
}

export function loanDetails(loan: PlaidStudentLoan): AccountDetails {
  return {
    interest_rate: clampRate(loan.interest_rate_percentage),
    minimum_payment_cents: nonNegative(toCents(loan.minimum_payment_amount)),
    next_payment_due_on: loan.next_payment_due_date,
    statement_balance_cents: toCents(loan.last_statement_balance ?? null),
    last_statement_on: loan.last_statement_issue_date,
  };
}

function clampRate(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate) || rate < 0 || rate > 100) return null;
  return Math.round(rate * 1000) / 1000;
}

function nonNegative(cents: number | null): number | null {
  return cents == null ? null : Math.max(0, cents);
}

export function holdingRows(
  data: PlaidHoldings,
  ctx: { userId: string; today: string; accounts: Map<string, { id: string; kind: AccountKind }> },
): HoldingRow[] {
  const securities = new Map(data.securities.map((s) => [s.security_id, s]));
  const rows = new Map<string, HoldingRow>();
  for (const h of data.holdings) {
    const account = ctx.accounts.get(h.account_id);
    if (!account) continue;
    const security = securities.get(h.security_id);
    const name = security?.name?.trim() || security?.ticker_symbol?.trim() || h.security_id;
    // One row per security per account per day: the upsert key.
    rows.set(`${account.id}:${h.security_id}`, {
      user_id: ctx.userId,
      account_id: account.id,
      security_id: h.security_id,
      ticker: security?.ticker_symbol?.trim() || null,
      security_name: name,
      quantity: h.quantity,
      value_cents: toCents(h.institution_value) ?? 0,
      cost_basis_cents: toCents(h.cost_basis),
      as_of: ctx.today,
    });
  }
  return [...rows.values()];
}

/** Runs a product's call, or skips it when Plaid says it does not apply to this Item. */
async function optional<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (NOT_APPLICABLE.has(plaidErrorCode(error) ?? '')) return null;
    throw error;
  }
}

export function failureNote(link: SyncLink, since: string, error: string): string {
  return [
    `Finances: the Plaid sync for ${link.institution_name} has failed every day since ${since}, three days running.`,
    `Last error: ${error}`,
    `Link ${link.id}. Its balances and transactions stop at the last good sync until this is fixed; Finances settings shows the link.`,
  ].join('\n\n');
}

/**
 * One run of one link. `today` is the person's day (YYYY-MM-DD) for the
 * balance reading and the holdings; `now` is when the run started, which
 * bounds the webhook events it marks handled.
 */
export async function syncLink(
  deps: SyncDeps,
  link: SyncLink,
  ctx: { today: string; now: string },
): Promise<SyncResult> {
  const { plaid, store } = deps;
  try {
    const accessToken = deps.decrypt(link.access_token);

    const plaidAccounts = await plaid.getAccounts(accessToken);
    const { accounts, balances } = accountRows(plaidAccounts, {
      userId: link.user_id,
      linkId: link.id,
      institutionName: link.institution_name,
      today: ctx.today,
    });
    await store.saveAccounts(link.user_id, accounts, balances);
    const ids = await store.accountIds(link.user_id, link.id);
    const kinds = new Set([...ids.values()].map((a) => a.kind));

    let tx = { added: 0, modified: 0, removed: 0, posted: 0 };
    if (kinds.has('checking') || kinds.has('savings') || kinds.has('credit_card')) {
      const pull = await optional(() => pullTransactions(plaid, accessToken, link.sync_cursor));
      if (pull) {
        tx = await applyTransactions(store, link.user_id, ids, pull);
        // Saved only after every page is written, so a run that stops part way
        // starts again from the same place.
        await store.updateLink(link.user_id, link.id, { sync_cursor: pull.cursor });
      }
    }

    let cards = 0;
    let loans = 0;
    if (kinds.has('credit_card') || kinds.has('loan')) {
      const liabilities = await optional(() => plaid.getLiabilities(accessToken));
      for (const card of liabilities?.credit ?? []) {
        const account = card.account_id ? ids.get(card.account_id) : undefined;
        if (account?.kind !== 'credit_card') continue;
        await store.updateAccountDetails(link.user_id, account.id, cardDetails(card));
        cards++;
      }
      for (const loan of liabilities?.student ?? []) {
        const account = loan.account_id ? ids.get(loan.account_id) : undefined;
        if (account?.kind !== 'loan') continue;
        await store.updateAccountDetails(link.user_id, account.id, loanDetails(loan));
        loans++;
      }
    }

    let holdings = 0;
    if (kinds.has('brokerage')) {
      const data = await optional(() => plaid.getHoldings(accessToken));
      if (data) {
        const rows = holdingRows(data, { userId: link.user_id, today: ctx.today, accounts: ids });
        if (rows.length) await store.upsertHoldings(rows);
        holdings = rows.length;
      }
    }

    // A login still waiting to be repeated (PENDING_EXPIRATION syncs until the
    // day it lapses) keeps its flag and its message.
    await store.updateLink(link.user_id, link.id, {
      last_synced_at: ctx.now,
      failing_since: null,
      failure_noted_on: null,
      ...(link.needs_update ? {} : { status: 'active' as const, last_error: null }),
    });
    await store.markEventsHandled(link.user_id, link.id, ctx.now);

    return { ok: true, accounts: ids.size, ...tx, cards, loans, holdings };
  } catch (error) {
    const code = plaidErrorCode(error);
    const message = plaidMessage(error).slice(0, 500);
    const needsUpdate = LOGIN_ERRORS.has(code ?? '');
    const since = link.failing_since ?? ctx.today;

    let noteId: string | null = null;
    if (!link.failure_noted_on && daysBetween(since, ctx.today) >= FAILING_DAYS_FOR_NOTE - 1) {
      noteId = await store.writeDevNote(link.user_id, failureNote(link, since, message)).catch(() => null);
    }

    await store.updateLink(link.user_id, link.id, {
      status: 'error',
      last_error: message,
      failing_since: since,
      ...(needsUpdate ? { needs_update: true } : {}),
      ...(noteId ? { failure_noted_on: ctx.today } : {}),
    });
    if (needsUpdate) await store.markEventsHandled(link.user_id, link.id, ctx.now);

    return { ok: false, error: message, code, needsUpdate, noteId };
  }
}

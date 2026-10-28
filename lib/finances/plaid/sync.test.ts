import { describe, expect, it, vi, type Mock } from 'vitest';
import recorded from './fixtures/sync-responses.json';
import type { AccountKind, AccountRow, BalanceRow, PlaidAccount } from './link';
import {
  daysBetween,
  syncLink,
  type AccountDetails,
  type HoldingRow,
  type LinkPatch,
  type PlaidHoldings,
  type SyncDeps,
  type SyncLink,
  type SyncPage,
  type SyncPlaidPort,
  type SyncStore,
  type TransactionRow,
} from './sync';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-28T12:00:00.000Z';

/** A Plaid error as the SDK throws it. */
function plaidError(code: string, message = `${code} happened`) {
  return Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { error_code: code, error_message: message, display_message: null } },
  });
}

/** The finances tables, kept in memory with the same keys the store upserts on. */
class MemoryStore implements SyncStore {
  links = new Map<string, Omit<SyncLink, 'sync_cursor'> & Omit<LinkPatch, 'sync_cursor'> & { sync_cursor?: string | null }>();
  accounts = new Map<string, AccountRow & { id: string } & Partial<AccountDetails>>();
  balances = new Map<string, { account_id: string; read_on: string; balance_cents: number }>();
  transactions = new Map<string, TransactionRow & { id: string; order_id?: string }>();
  holdings = new Map<string, HoldingRow>();
  handledUpTo: string | null = null;
  notes: string[] = [];
  private seq = 0;

  async saveAccounts(_userId: string, accounts: AccountRow[], balances: BalanceRow[]) {
    for (const a of accounts) {
      const existing = this.accounts.get(a.plaid_account_id);
      this.accounts.set(a.plaid_account_id, { ...existing, ...a, id: existing?.id ?? `acct-${++this.seq}` });
    }
    for (const b of balances) {
      const id = this.accounts.get(b.plaid_account_id)!.id;
      this.balances.set(`${id}:${b.read_on}`, { account_id: id, read_on: b.read_on, balance_cents: b.balance_cents });
    }
    return accounts.length;
  }
  async accountIds(_userId: string, linkId: string) {
    const ids = new Map<string, { id: string; kind: AccountKind }>();
    for (const a of this.accounts.values()) if (a.link_id === linkId) ids.set(a.plaid_account_id, { id: a.id, kind: a.kind });
    return ids;
  }
  async existingTransactions(_userId: string, ids: string[]) {
    return new Set(ids.filter((id) => this.transactions.has(id)));
  }
  async renameTransaction(_userId: string, from: string, to: string) {
    const row = this.transactions.get(from)!;
    this.transactions.delete(from);
    this.transactions.set(to, { ...row, plaid_transaction_id: to });
  }
  async upsertTransactions(rows: TransactionRow[]) {
    const keys = rows.map((r) => r.plaid_transaction_id);
    if (new Set(keys).size !== keys.length) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time');
    for (const r of rows) {
      const existing = this.transactions.get(r.plaid_transaction_id);
      this.transactions.set(r.plaid_transaction_id, { ...existing, ...r, id: existing?.id ?? `tx-${++this.seq}` });
    }
  }
  async deleteTransactions(_userId: string, ids: string[]) {
    for (const id of ids) this.transactions.delete(id);
  }
  async updateAccountDetails(_userId: string, accountId: string, details: AccountDetails) {
    const [key, row] = [...this.accounts.entries()].find(([, a]) => a.id === accountId)!;
    if (row.kind !== 'loan' && row.kind !== 'credit_card') throw new Error('violates accounts_loan_fields_ck');
    this.accounts.set(key, { ...row, ...details });
  }
  async upsertHoldings(rows: HoldingRow[]) {
    for (const h of rows) this.holdings.set(`${h.account_id}:${h.as_of}:${h.security_id}`, h);
  }
  async updateLink(_userId: string, linkId: string, patch: LinkPatch) {
    this.links.set(linkId, { ...this.links.get(linkId)!, ...patch });
  }
  async markEventsHandled(_userId: string, _linkId: string, upTo: string) {
    this.handledUpTo = upTo;
  }
  async writeDevNote(_userId: string, body: string) {
    this.notes.push(body);
    return `note-${this.notes.length}`;
  }

  link(id: string): SyncLink {
    const row = this.links.get(id)!;
    return { ...row, sync_cursor: row.sync_cursor ?? null };
  }
  balanceOn(plaidAccountId: string, day: string) {
    return this.balances.get(`${this.accounts.get(plaidAccountId)!.id}:${day}`)?.balance_cents;
  }
}

function chase(over: Partial<SyncLink> = {}): SyncLink {
  return {
    id: 'link-chase',
    user_id: USER,
    institution_name: 'Chase',
    access_token: 'v1:enc(access-chase)',
    sync_cursor: null,
    needs_update: false,
    failing_since: null,
    failure_noted_on: null,
    ...over,
  };
}

type MockPort = { [K in keyof SyncPlaidPort]: Mock<SyncPlaidPort[K]> };

/** Plaid answering from the recorded responses, a call at a time. */
function plaidFake(over: { getAccounts?: () => Promise<PlaidAccount[]> } = {}): MockPort {
  const pages: Record<string, SyncPage> = {
    '': recorded.sync_day_one as SyncPage,
    [recorded.sync_day_one.next_cursor]: recorded.sync_day_two as SyncPage,
  };
  return {
    getAccounts: vi.fn(over.getAccounts ?? (async () => recorded.accounts.accounts as PlaidAccount[])),
    transactionsSync: vi.fn(async (_token: string, cursor: string | null) => {
      const page = pages[cursor ?? ''];
      if (!page) return { added: [], modified: [], removed: [], next_cursor: cursor ?? '', has_more: false };
      return page;
    }),
    getLiabilities: vi.fn(async () => ({
      credit: recorded.liabilities.liabilities.credit,
      student: recorded.liabilities.liabilities.student,
    })),
    getHoldings: vi.fn(async () => recorded.holdings as PlaidHoldings),
  };
}

function setup(link: SyncLink = chase(), plaid = plaidFake()) {
  const store = new MemoryStore();
  store.links.set(link.id, { ...link });
  const deps: SyncDeps = { plaid, store, decrypt: (c) => c.replace(/^v1:enc\((.*)\)$/, '$1') };
  return { store, plaid, deps };
}

const CHECKING = 'BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp';
const CARD = '3gE5gnRzNyfXpBK5wEEKcymJ5albGVUqg77gr';
const LOAN = 'Pp1Vpkl9w8sajvK6oEEKtr7vZxBnGpf7LxxLE';
const PENDING = 'pending-coffee-lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje';
const POSTED = 'posted-coffee-4zBRq1Qem4uAPnoyKjJNTRQpQddM4ztlo1PLD';
const REFUND = 'refund-dup-9y4W3k1MaLsZoV2aKP0qBb6Ra8kaDqHRjM5D8';

describe('syncLink, one morning', () => {
  it('reads today’s balance for every account and brings in the transactions with the sign flipped', async () => {
    const { store, deps } = setup();
    const result = await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });

    expect(result).toMatchObject({ ok: true, accounts: 3, added: 4, cards: 1, loans: 1 });
    expect(store.balanceOn(CHECKING, '2026-10-28')).toBe(123456);
    expect(store.balanceOn(CARD, '2026-10-28')).toBe(41020);
    expect(store.balanceOn(LOAN, '2026-10-28')).toBe(6526200);

    expect(store.transactions.size).toBe(4);
    expect(store.transactions.get(PENDING)).toMatchObject({ amount_cents: -433, pending: true, merchant: 'Starbucks' });
    expect(store.transactions.get('payroll-Kdn7aoD4oQh8mJGg4dEXFmvQ5lp9DTaPnDMLz')).toMatchObject({
      amount_cents: 250000,
      merchant: null,
      category: 'INCOME',
      category_detail: 'INCOME_WAGES',
    });

    const link = store.links.get('link-chase')!;
    expect(link.sync_cursor).toBe(recorded.sync_day_one.next_cursor);
    expect(link.last_synced_at).toBe(NOW);
    expect(link.status).toBe('active');
    expect(store.handledUpTo).toBe(NOW);
  });

  it('gives the card its statement balance, due date, minimum and purchase APR, and the loan its own', async () => {
    const { store, deps } = setup();
    await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(store.accounts.get(CARD)).toMatchObject({
      statement_balance_cents: 170877,
      last_statement_on: '2026-10-10',
      next_payment_due_on: '2026-11-07',
      minimum_payment_cents: 2000,
      interest_rate: 21.49,
    });
    expect(store.accounts.get(LOAN)).toMatchObject({
      interest_rate: 5.25,
      minimum_payment_cents: 2500,
      next_payment_due_on: '2026-11-01',
    });
  });

  it('asks for no holdings from an Item with no brokerage account', async () => {
    const { store, deps, plaid } = setup();
    await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(plaid.getHoldings).not.toHaveBeenCalled();
  });
});

describe('syncLink, the next morning', () => {
  async function twoMornings() {
    const s = setup();
    await syncLink(s.deps, s.store.link('link-chase'), { today: '2026-10-28', now: NOW });
    // An order was tied to the pending coffee before it posted.
    s.store.transactions.set(PENDING, { ...s.store.transactions.get(PENDING)!, order_id: 'order-1' });
    const pendingRowId = s.store.transactions.get(PENDING)!.id;
    const result = await syncLink(s.deps, s.store.link('link-chase'), { today: '2026-10-29', now: '2026-10-29T12:00:00.000Z' });
    return { ...s, result, pendingRowId };
  }

  it('replaces the pending charge with the posted one on the same row, keeping what was tied to it', async () => {
    const { store, result, pendingRowId } = await twoMornings();
    expect(result).toMatchObject({ ok: true, added: 1, modified: 1, removed: 2, posted: 1 });
    expect(store.transactions.has(PENDING)).toBe(false);
    expect(store.transactions.get(POSTED)).toMatchObject({
      id: pendingRowId,
      order_id: 'order-1',
      pending: false,
      amount_cents: -483,
      posted_on: '2026-10-28',
    });
  });

  it('removes what Plaid removed and takes what it changed', async () => {
    const { store } = await twoMornings();
    expect(store.transactions.has(REFUND)).toBe(false);
    expect(store.transactions.get('uber-ejKD6Qn0VeHLQ1yvaXGqHMGWgBRrN8f7mQDEq')?.description).toBe('Uber Trip');
    expect(store.transactions.size).toBe(3);
    expect(store.links.get('link-chase')!.sync_cursor).toBe(recorded.sync_day_two.next_cursor);
  });

  it('drops the pending row when the posted one is already here', async () => {
    const s = setup();
    await syncLink(s.deps, s.store.link('link-chase'), { today: '2026-10-28', now: NOW });
    await s.store.upsertTransactions([{ ...s.store.transactions.get(PENDING)!, plaid_transaction_id: POSTED }]);
    // Plaid sends the posting without listing the pending id as removed.
    s.plaid.transactionsSync.mockResolvedValueOnce({ ...(recorded.sync_day_two as SyncPage), removed: [] });
    await syncLink(s.deps, s.store.link('link-chase'), { today: '2026-10-29', now: NOW });
    expect(s.store.transactions.has(PENDING)).toBe(false);
    expect(s.store.transactions.get(POSTED)?.pending).toBe(false);
  });
});

describe('syncLink, holdings', () => {
  it('writes each holding’s value for today', async () => {
    const plaid = plaidFake({
      getAccounts: vi.fn(async () => recorded.brokerage_accounts.accounts as PlaidAccount[]),
    });
    const { store, deps } = setup(chase({ id: 'link-broker', institution_name: 'Fidelity' }), plaid);
    const result = await syncLink(deps, store.link('link-broker'), { today: '2026-10-28', now: NOW });
    expect(result).toMatchObject({ ok: true, holdings: 2 });
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
    expect(plaid.getLiabilities).not.toHaveBeenCalled();
    const ewz = [...store.holdings.values()].find((h) => h.ticker === 'EWZ');
    expect(ewz).toMatchObject({ value_cents: 63631, cost_basis_cents: 2300, quantity: 23.567, as_of: '2026-10-28' });
    expect(store.balanceOn('JqMLm4rJwpF6gMPJwBqdh9ZjjPvvpDcb7kDK1', '2026-10-28')).toBe(2363198);
  });
});

describe('syncLink, when Plaid refuses', () => {
  it('marks a link whose login must be repeated as needing attention', async () => {
    const plaid = plaidFake({
      getAccounts: vi.fn(async () => {
        throw plaidError('ITEM_LOGIN_REQUIRED', 'the login details of this item have changed');
      }),
    });
    const { store, deps } = setup(chase(), plaid);
    const result = await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(result).toMatchObject({ ok: false, code: 'ITEM_LOGIN_REQUIRED', needsUpdate: true });
    expect(store.links.get('link-chase')).toMatchObject({
      needs_update: true,
      status: 'error',
      last_error: 'the login details of this item have changed',
      failing_since: '2026-10-28',
    });
  });

  it('files one Dev note on the third day running, and clears the streak once a sync works', async () => {
    const failing = vi.fn(async (): Promise<PlaidAccount[]> => {
      throw plaidError('INSTITUTION_DOWN');
    });
    const { store, deps, plaid } = setup(chase(), plaidFake({ getAccounts: failing }));
    for (const day of ['2026-10-26', '2026-10-27']) {
      await syncLink(deps, store.link('link-chase'), { today: day, now: `${day}T12:00:00.000Z` });
    }
    expect(store.notes).toHaveLength(0);
    await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0]).toMatch(/Chase has failed every day since 2026-10-26/);
    await syncLink(deps, store.link('link-chase'), { today: '2026-10-29', now: NOW });
    expect(store.notes).toHaveLength(1);
    expect(store.links.get('link-chase')).toMatchObject({ failing_since: '2026-10-26', failure_noted_on: '2026-10-28' });

    plaid.getAccounts.mockImplementation(async () => recorded.accounts.accounts as PlaidAccount[]);
    await syncLink(deps, store.link('link-chase'), { today: '2026-10-30', now: NOW });
    expect(store.links.get('link-chase')).toMatchObject({
      failing_since: null,
      failure_noted_on: null,
      status: 'active',
      last_error: null,
    });
  });

  it('starts the pull again from the saved cursor when Plaid’s data moves mid-way', async () => {
    const { store, deps, plaid } = setup();
    plaid.transactionsSync.mockRejectedValueOnce(plaidError('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'));
    const result = await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(result).toMatchObject({ ok: true, added: 4 });
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(2);
  });

  it('skips a product Plaid says the Item does not have', async () => {
    const { store, deps, plaid } = setup();
    plaid.getLiabilities.mockRejectedValueOnce(plaidError('PRODUCTS_NOT_SUPPORTED'));
    const result = await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(result).toMatchObject({ ok: true, cards: 0, loans: 0, added: 4 });
  });

  it('keeps a pending expiry’s flag through a sync that works', async () => {
    const { store, deps } = setup(chase({ needs_update: true }));
    store.links.set('link-chase', { ...store.links.get('link-chase')!, last_error: 'expires soon' });
    await syncLink(deps, store.link('link-chase'), { today: '2026-10-28', now: NOW });
    expect(store.links.get('link-chase')).toMatchObject({ needs_update: true, last_error: 'expires soon' });
  });
});

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-10-26', '2026-10-28')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
  });
});

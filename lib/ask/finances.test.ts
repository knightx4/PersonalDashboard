import { describe, expect, it } from 'vitest';
import type { ModuleId } from '@/lib/modules';
import type { AskContext, SchemaClient } from './db';
import { samplePoints } from './finances';
import { executeAskTool, lookupInScope } from './tools';

/**
 * Dash's Finances lookups (plan #2593.8.1) against an in-memory client that
 * applies the filters supabase-js would, with another person's rows beside
 * the asker's so a read that forgot to filter would show it.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const TODAY = '2026-10-20';

const CHECKING = '10000000-0000-4000-8000-000000000001';
const CARD = '10000000-0000-4000-8000-000000000002';
const SAVINGS = '10000000-0000-4000-8000-000000000003';
const THEIR_CARD = '10000000-0000-4000-8000-000000000009';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

class Query implements PromiseLike<{ data: Row[] | Row | null; error: null }> {
  private filters: ((row: Row) => boolean)[] = [];
  private sorts: { column: string; ascending: boolean }[] = [];
  private window: [number, number] | null = null;
  private cap: number | null = null;
  private one = false;

  constructor(private readonly rows: Row[]) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) >= value);
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) <= value);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.sorts.push({ column, ascending: options.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }

  then<A = { data: Row[] | Row | null; error: null }, B = never>(
    resolve?: ((value: { data: Row[] | Row | null; error: null }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let out = this.rows.filter((row) => this.filters.every((f) => f(row)));
    out = [...out].sort((a, b) => {
      for (const { column, ascending } of this.sorts) {
        const cmp = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
        if (cmp) return ascending ? cmp : -cmp;
      }
      return 0;
    });
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    if (this.cap !== null) out = out.slice(0, this.cap);
    const data = this.one ? (out[0] ?? null) : out;
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

function fakeClient(tables: Tables) {
  const bound = (schema: string) => ({ from: (table: string) => new Query(tables[`${schema}.${table}`] ?? []) });
  return { ...bound('public'), schema: (name: string) => bound(name) };
}

const ALL: ModuleId[] = ['shopping', 'finances', 'goals'];

function context(tables: Tables, enabledModules: ModuleId[] = ALL): AskContext {
  const client = fakeClient(tables) as unknown as SchemaClient;
  return { userId: ME, today: TODAY, enabledModules, db: async () => client, searchSources: [] };
}

const account = (id: string, userId: string, name: string, kind: string, extra: Row = {}): Row => ({
  id,
  user_id: userId,
  name,
  official_name: null,
  institution_name: 'Chase',
  mask: id.slice(-4),
  kind,
  source: 'plaid',
  link_id: null,
  credit_limit_cents: null,
  interest_rate: null,
  minimum_payment_cents: null,
  next_payment_due_on: null,
  statement_balance_cents: null,
  closed_on: null,
  hidden: false,
  ...extra,
});

const reading = (accountId: string, userId: string, readOn: string, cents: number): Row => ({
  account_id: accountId,
  user_id: userId,
  read_on: readOn,
  balance_cents: cents,
});

let next = 0;
const txn = (accountId: string, userId: string, postedOn: string, cents: number, description: string, extra: Row = {}): Row => ({
  id: `20000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`,
  account_id: accountId,
  user_id: userId,
  amount_cents: cents,
  posted_on: postedOn,
  description,
  merchant: null,
  category: null,
  category_detail: null,
  pending: false,
  order_id: null,
  recurring_payment_id: null,
  internal_kind: null,
  ...extra,
});

const TABLES: Tables = {
  'finances.accounts': [
    account(CHECKING, ME, 'Total Checking', 'checking'),
    account(CARD, ME, 'Sapphire', 'credit_card', {
      credit_limit_cents: 1_000_000,
      minimum_payment_cents: 4000,
      next_payment_due_on: '2026-10-23',
      statement_balance_cents: 110_000,
    }),
    account(SAVINGS, ME, 'Savings', 'savings'),
    account(THEIR_CARD, THEM, 'Their card', 'credit_card'),
  ],
  'finances.balance_readings': [
    reading(CHECKING, ME, '2026-08-31', 400_000),
    reading(CHECKING, ME, '2026-10-20', 500_000),
    reading(CARD, ME, '2026-10-20', 120_000),
    reading(SAVINGS, ME, '2026-07-01', 1_000_000),
    reading(SAVINGS, ME, '2026-08-01', 1_050_000),
    reading(SAVINGS, ME, '2026-09-01', 1_100_000),
    reading(SAVINGS, ME, '2026-10-01', 1_150_000),
    reading(THEIR_CARD, THEM, '2026-10-20', 9_999_999),
  ],
  'finances.transactions': [
    txn(CARD, ME, '2026-09-03', -5000, 'WHOLEFDS #123', { merchant: 'Whole Foods', category: 'FOOD_AND_DRINK' }),
    txn(CARD, ME, '2026-09-10', -12000, 'UNITED 016', { merchant: 'United', category: 'TRAVEL' }),
    txn(CARD, ME, '2026-09-12', 2000, 'UNITED REFUND', { merchant: 'United', category: 'TRAVEL' }),
    txn(CARD, ME, '2026-10-04', -3000, 'WHOLEFDS #123', { merchant: 'Whole Foods', category: 'FOOD_AND_DRINK' }),
    // Checking pays the card: both halves are left out.
    txn(CHECKING, ME, '2026-09-28', -15000, 'CHASE CREDIT CRD AUTOPAY'),
    txn(CARD, ME, '2026-09-29', 15000, 'Payment Thank You'),
    txn(CHECKING, ME, '2026-09-30', 300_000, 'ACME PAYROLL', { category: 'INCOME' }),
    txn(CARD, ME, '2026-10-18', -999, 'PENDING THING', { pending: true }),
    txn(THEIR_CARD, THEM, '2026-09-05', -777_700, 'THEIR SHOP', { merchant: 'Whole Foods' }),
  ],
};

describe('accounts', () => {
  it('gives each of their accounts with its balance, and net worth with owed balances subtracted', async () => {
    const result = await executeAskTool('accounts', {}, context(TABLES));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.title).sort()).toEqual(['Sapphire\u00a0··0002', 'Savings\u00a0··0003', 'Total Checking\u00a0··0001']);
    expect(result.rows.every((r) => r.href.startsWith('/finances/accounts/'))).toBe(true);
    // 5,000 + 11,500 - 1,200 owed on the card.
    expect(result.totals).toMatchObject({ net_worth: '$15,300.00' });
    const card = result.rows.find((r) => r.ref === CARD)!;
    expect(card.detail).toMatchObject({
      balance: '$1,200.00',
      balance_is_owed: true,
      payment_due: '2026-10-23',
      minimum_payment: '$40.00',
      limit_used: '12%',
      statement_balance: '$1,100.00',
    });
  });

  it('says there are none yet rather than failing', async () => {
    const result = await executeAskTool('accounts', {}, context({}));
    expect(result).toMatchObject({ ok: true, rows: [] });
  });

  it('is off with Finances off', async () => {
    const result = await executeAskTool('accounts', {}, context(TABLES, ['shopping']));
    expect(result).toEqual({ ok: false, error: 'The Finances workspace is switched off, so it cannot be read.' });
  });
});

describe('balance_history', () => {
  it("follows one account, found by words of its name, from the balance it held on the first day", async () => {
    const result = await executeAskTool('balance_history', { account: 'savings', from: '2026-07-15', to: '2026-10-15' }, context(TABLES));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totals).toMatchObject({
      of: 'Savings\u00a0··0003',
      start: '$10,000.00',
      end: '$11,500.00',
      change: '$1,500.00',
      highest: { day: '2026-10-01', balance: '$11,500.00' },
    });
    // Over 45 days: the first day and each month's last.
    expect((result.totals!.points as { day: string }[]).map((p) => p.day)).toEqual([
      '2026-07-15',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-15',
    ]);
  });

  it('gives net worth when no account is named, and refuses an account that is not theirs', async () => {
    const worth = await executeAskTool('balance_history', { from: '2026-10-01', to: '2026-10-20' }, context(TABLES));
    expect(worth.ok && worth.totals).toMatchObject({ of: 'net worth', end: '$15,300.00' });
    const theirs = await executeAskTool('balance_history', { account: THEIR_CARD }, context(TABLES));
    expect(theirs.ok).toBe(false);
  });
});

describe('spend_by_merchant from transactions', () => {
  it('counts a card purchase once, leaves the payment from checking out, and reads only their rows', async () => {
    const result = await executeAskTool('spend_by_merchant', { from: '2026-09-01', to: '2026-09-30' }, context(TABLES));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totals).toMatchObject({
      source: 'bank and card transactions',
      // 50 + 120 - 20 refunded.
      spent: '$150.00',
      refunds: '$20.00',
      money_in: '$3,000.00',
      left_out_card_payments_and_transfers: { amount: '$150.00', count: 1 },
      by_month: [{ month: '2026-09', spent: '$150.00' }],
      by_category: [
        { category: 'Travel', spent: '$100.00' },
        { category: 'Food and drink', spent: '$50.00' },
      ],
    });
    expect(result.rows.map((r) => r.title)).toEqual(['United', 'United', 'Whole Foods']);
    expect(result.rows[0].parent).toMatchObject({ table: 'finances.accounts', ref: CARD });
    expect(JSON.stringify(result)).not.toContain('7,777');
  });

  it('narrows to a merchant and a category, and leaves pending charges out', async () => {
    const shop = await executeAskTool('spend_by_merchant', { from: '2026-09-01', to: '2026-10-20', merchant: 'whole foods' }, context(TABLES));
    expect(shop.ok && shop.totals).toMatchObject({
      spent: '$80.00',
      by_month: [
        { month: '2026-09', spent: '$50.00' },
        { month: '2026-10', spent: '$30.00' },
      ],
    });
    const travel = await executeAskTool('spend_by_merchant', { from: '2026-09-01', to: '2026-10-20', category: 'travel' }, context(TABLES));
    expect(travel.ok && travel.totals).toMatchObject({ spent: '$100.00' });
    const all = await executeAskTool('spend_by_merchant', { from: '2026-10-01' }, context(TABLES));
    expect(all.ok && all.note).toContain('1 pending transaction is left out');
  });

  it('answers from order emails when Finances holds no transactions', async () => {
    const result = await executeAskTool(
      'spend_by_merchant',
      { from: '2026-09-01' },
      context({
        'public.orders': [],
        'public.returns': [],
      }),
    );
    expect(result.ok && result.note).toMatch(/^From order emails/);
  });

  it('is offered in Finances and in Shopping; accounts and balance_history only in Finances', () => {
    expect(lookupInScope('spend_by_merchant', 'finances')).toBe(true);
    expect(lookupInScope('spend_by_merchant', 'shopping')).toBe(true);
    expect(lookupInScope('spend_by_merchant', 'jobs')).toBe(false);
    expect(lookupInScope('accounts', 'finances')).toBe(true);
    expect(lookupInScope('balance_history', 'shopping')).toBe(false);
  });
});

describe('samplePoints', () => {
  it('keeps every point of a short period', () => {
    const points = [{ day: '2026-01-01', cents: 1 }, { day: '2026-01-02', cents: 2 }];
    expect(samplePoints(points)).toEqual(points);
  });
});

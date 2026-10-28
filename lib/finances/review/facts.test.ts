import { describe, expect, it } from 'vitest';
import type { Reading } from '@/lib/finances/accounts';
import type { SpendTransaction } from '@/lib/finances/spending/types';
import { buildMonthFacts, dayLabel, monthBefore, monthEnd, reviewMonthFor, type ReviewAccount } from './facts';

function account(over: Partial<ReviewAccount> & Pick<ReviewAccount, 'id' | 'name' | 'kind'>): ReviewAccount {
  return {
    officialName: null,
    institutionName: null,
    mask: null,
    source: 'manual',
    linkId: null,
    creditLimitCents: null,
    interestRate: null,
    minimumPaymentCents: null,
    nextPaymentDueOn: null,
    statementBalanceCents: null,
    closedOn: null,
    hidden: false,
    ...over,
  };
}

const checking = account({ id: 'chk', name: 'Checking', kind: 'checking', mask: '1234' });
const card = account({
  id: 'card',
  name: 'Sapphire',
  kind: 'credit_card',
  mask: '9012',
  minimumPaymentCents: 3_500,
  statementBalanceCents: 120_400,
  nextPaymentDueOn: '2026-11-07',
});
const accounts = [checking, card];

let seq = 0;
function tx(over: Partial<SpendTransaction> & Pick<SpendTransaction, 'accountId' | 'amountCents' | 'postedOn'>): SpendTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    description: 'Something',
    merchant: null,
    category: null,
    categoryDetail: null,
    pending: false,
    orderId: null,
    recurringPaymentId: null,
    internalKind: null,
    ...over,
  };
}

const build = (transactions: SpendTransaction[], readings: Reading[] = [], over: Partial<{ accounts: ReviewAccount[] }> = {}) =>
  buildMonthFacts({ month: '2026-10', today: '2026-11-01', accounts: over.accounts ?? accounts, transactions, readings });

describe('months', () => {
  it('reviews the month before the day it is written, across a year', () => {
    expect(reviewMonthFor('2026-11-01')).toBe('2026-10');
    expect(reviewMonthFor('2027-01-01')).toBe('2026-12');
    expect(monthBefore('2026-02', 3)).toBe('2025-11');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(dayLabel('2026-11-07')).toBe('7 November');
  });
});

describe('a month with nothing in it', () => {
  it('has no facts and says so', () => {
    const facts = build([], [], { accounts: [checking] });
    expect(facts.facts).toEqual([]);
    expect(facts.plainSummary).toBe('Nothing came through your accounts in October, so there is nothing to review.');
    expect(facts.label).toBe('October 2026');
  });
});

describe('spending', () => {
  it('compares the month and each category with the months before, and links every charge', () => {
    const october = [
      tx({ accountId: 'card', amountCents: -30_000, postedOn: '2026-10-05', merchant: 'Whole Foods', category: 'FOOD_AND_DRINK' }),
      tx({ accountId: 'card', amountCents: -10_000, postedOn: '2026-10-12', merchant: 'Shell', category: 'TRANSPORTATION' }),
    ];
    const earlier = [
      tx({ accountId: 'card', amountCents: -20_000, postedOn: '2026-09-05', merchant: 'Whole Foods', category: 'FOOD_AND_DRINK' }),
      tx({ accountId: 'card', amountCents: -20_000, postedOn: '2026-08-05', merchant: 'Whole Foods', category: 'FOOD_AND_DRINK' }),
    ];
    // Checking pays the card: not spending, and on no line.
    const paymentOut = tx({ accountId: 'chk', amountCents: -40_000, postedOn: '2026-10-20', description: 'CHASE CREDIT CRD AUTOPAY' });
    const paymentIn = tx({ accountId: 'card', amountCents: 40_000, postedOn: '2026-10-21', description: 'AUTOMATIC PAYMENT - THANK YOU' });

    const facts = build([...october, ...earlier, paymentOut, paymentIn]);
    const spending = facts.facts.find((f) => f.id === 'spending')!;
    expect(spending.plain).toBe('You spent $400.00 in October across 2 charges, against $200.00 a month over the 2 months before.');
    expect(new Set(spending.transactionIds)).toEqual(new Set(october.map((t) => t.id)));

    const food = facts.facts.find((f) => f.id === 'category:food and drink')!;
    expect(food.plain).toBe('Food and drink came to $300.00, up from $200.00 a month before.');
    expect(food.transactionIds).toEqual([october[0].id]);

    const transport = facts.facts.find((f) => f.id === 'category:transportation')!;
    expect(transport.plain).toBe('Transportation came to $100.00, with nothing in the months before.');
    expect(facts.plainSummary).toBe('In October you spent $400.00.');
  });
});

describe('subscriptions', () => {
  it('names one that started repeating this month and one whose price changed', () => {
    const monthly = (merchant: string, cents: number[], days: string[]) =>
      days.map((d, i) => tx({ accountId: 'card', amountCents: -cents[i], postedOn: d, merchant }));
    const news = monthly('Netflix', [1_549, 1_549, 1_549], ['2026-08-03', '2026-09-03', '2026-10-03']);
    const changed = monthly('Spotify', [1_099, 1_099, 1_099, 1_199], ['2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10']);

    const facts = build([...news, ...changed]);
    const netflix = facts.facts.find((f) => f.kind === 'new_subscription')!;
    expect(netflix.plain).toBe('Netflix now charges $15.49 a month, 3 times since 3 August.');
    expect(netflix.transactionIds).toEqual(news.map((t) => t.id));

    const spotify = facts.facts.find((f) => f.kind === 'changed_subscription')!;
    expect(spotify.plain).toBe('Spotify went from $10.99 to $11.99 a month.');
    expect(spotify.transactionIds).toEqual([changed[2].id, changed[3].id]);
    // A subscription is never also an unusual charge.
    expect(facts.facts.filter((f) => f.kind === 'unusual')).toEqual([]);
  });
});

describe('unusual charges', () => {
  it('names a charge far above the usual at that merchant, and a large first charge', () => {
    const usual = [
      tx({ accountId: 'card', amountCents: -4_000, postedOn: '2026-06-02', merchant: 'Delta' }),
      tx({ accountId: 'card', amountCents: -4_000, postedOn: '2026-08-20', merchant: 'Delta' }),
    ];
    const big = tx({ accountId: 'card', amountCents: -84_210, postedOn: '2026-10-14', merchant: 'Delta' });
    const first = tx({ accountId: 'card', amountCents: -60_000, postedOn: '2026-10-18', merchant: 'Apple Store' });
    const small = tx({ accountId: 'card', amountCents: -3_000, postedOn: '2026-10-19', merchant: 'Corner Cafe' });

    const facts = build([...usual, big, first, small]);
    const unusual = facts.facts.filter((f) => f.kind === 'unusual');
    expect(unusual.map((f) => f.plain)).toEqual([
      '$842.10 at Delta on 14 October, where a charge is usually $40.00.',
      '$600.00 at Apple Store on 18 October, the first charge from them in a year.',
    ]);
    expect(unusual.map((f) => f.transactionIds)).toEqual([[big.id], [first.id]]);
  });
});

describe('interest, payments due and net worth', () => {
  it('sums interest on a card, names a card due within two weeks, and moves net worth over the month', () => {
    const interest = tx({
      accountId: 'card',
      amountCents: -2_310,
      postedOn: '2026-10-25',
      description: 'PURCHASE INTEREST CHARGE',
      categoryDetail: 'BANK_FEES_INTEREST_CHARGE',
    });
    const readings: Reading[] = [
      { accountId: 'chk', readOn: '2026-09-15', balanceCents: 500_000 },
      { accountId: 'card', readOn: '2026-09-15', balanceCents: 100_000 },
      { accountId: 'chk', readOn: '2026-10-31', balanceCents: 550_000 },
      // After the month: left out.
      { accountId: 'chk', readOn: '2026-11-01', balanceCents: 1 },
    ];
    const facts = build([interest], readings);

    const charged = facts.facts.find((f) => f.kind === 'interest')!;
    expect(charged.plain).toBe('Sapphire\u00a0··9012 charged $23.10 in interest.');
    expect(charged.transactionIds).toEqual([interest.id]);

    const due = facts.facts.find((f) => f.kind === 'due')!;
    expect(due.plain).toBe('Sapphire\u00a0··9012 is due on 7 November: $35.00 at least, $1,204.00 to clear the statement.');
    expect(due.accountIds).toEqual(['card']);

    const worth = facts.facts.find((f) => f.kind === 'net_worth')!;
    expect(worth.plain).toBe('Net worth went from $4,000.00 on 30 September to $4,500.00 on 31 October, up $500.00.');
    expect(new Set(worth.accountIds)).toEqual(new Set(['chk', 'card']));
  });

  it('leaves out a payment due beyond two weeks or on a hidden card', () => {
    const later = account({ ...card, id: 'later', nextPaymentDueOn: '2026-11-30' });
    const hidden = account({ ...card, id: 'hidden', hidden: true });
    expect(build([], [], { accounts: [later, hidden] }).facts).toEqual([]);
  });
});

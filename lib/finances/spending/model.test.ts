import { describe, expect, it } from 'vitest';
import { matchInternal } from './internal';
import { classify, findRepeating, summarizeTransactions } from './model';
import { matchOrders, sameMerchant } from './orders';
import type { SpendAccount, SpendTransaction } from './types';

const accounts: SpendAccount[] = [
  { id: 'chk', name: 'Chase checking', kind: 'checking', hidden: false, mask: '1234' },
  { id: 'sav', name: 'Chase savings', kind: 'savings', hidden: false, mask: '5678' },
  { id: 'card', name: 'Sapphire', kind: 'credit_card', hidden: false, mask: '9012' },
  { id: 'apple', name: 'Apple Card', kind: 'credit_card', hidden: false, mask: null },
];

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

function summarize(transactions: SpendTransaction[], period = { start: '2026-10-01', end: '2026-10-31' }) {
  const internal = matchInternal(transactions, accounts);
  return summarizeTransactions({
    transactions,
    accounts,
    internal,
    orderFor: new Map(),
    period,
    today: '2026-10-28',
  });
}

describe('card payments and transfers', () => {
  it('counts a purchase once on the card and not again when checking pays the card', () => {
    const purchase = tx({ accountId: 'card', amountCents: -12_000, postedOn: '2026-10-03', merchant: 'Target', category: 'GENERAL_MERCHANDISE' });
    const paymentOut = tx({ accountId: 'chk', amountCents: -12_000, postedOn: '2026-10-20', description: 'CHASE CREDIT CRD AUTOPAY' });
    const paymentIn = tx({ accountId: 'card', amountCents: 12_000, postedOn: '2026-10-21', description: 'AUTOMATIC PAYMENT - THANK YOU' });
    const s = summarize([purchase, paymentOut, paymentIn]);

    expect(s.outCents).toBe(12_000);
    expect(s.refundCents).toBe(0);
    expect(s.spentCents).toBe(12_000);
    expect(s.inCents).toBe(0);
    expect(s.internalCount).toBe(1);
    expect(s.internalCents).toBe(12_000);

    const internal = matchInternal([purchase, paymentOut, paymentIn], accounts);
    expect(internal.get(paymentOut.id)).toEqual({ kind: 'card_payment', pairId: paymentIn.id, by: 'pair' });
    expect(internal.get(paymentIn.id)?.kind).toBe('card_payment');
    expect(internal.has(purchase.id)).toBe(false);
  });

  it('leaves a transfer from checking to savings out of money in and out', () => {
    const out = tx({ accountId: 'chk', amountCents: -50_000, postedOn: '2026-10-05', description: 'Online Transfer to SAV ...5678' });
    const into = tx({ accountId: 'sav', amountCents: 50_000, postedOn: '2026-10-05', description: 'Online Transfer from CHK ...1234' });
    const pay = tx({ accountId: 'chk', amountCents: 300_000, postedOn: '2026-10-01', description: 'ACME PAYROLL', category: 'INCOME' });
    const s = summarize([out, into, pay]);

    expect(matchInternal([out, into, pay], accounts).get(out.id)?.kind).toBe('transfer');
    expect(s.inCents).toBe(300_000);
    expect(s.outCents).toBe(0);
  });

  it('does not pair two halves that do not read as a payment or transfer', () => {
    const groceries = tx({ accountId: 'chk', amountCents: -4_500, postedOn: '2026-10-05', merchant: 'Whole Foods' });
    const refund = tx({ accountId: 'card', amountCents: 4_500, postedOn: '2026-10-06', merchant: 'Target' });
    expect(matchInternal([groceries, refund], accounts).size).toBe(0);
  });

  it('does not pair halves more than four days apart', () => {
    const out = tx({ accountId: 'chk', amountCents: -9_900, postedOn: '2026-10-01', description: 'Payment to card' });
    const into = tx({ accountId: 'card', amountCents: 9_900, postedOn: '2026-10-09', description: 'Payment received' });
    expect(matchInternal([out, into], accounts).has(out.id)).toBe(false);
  });

  it('marks a card payment by its category when the card is not linked', () => {
    const out = tx({
      accountId: 'chk',
      amountCents: -30_000,
      postedOn: '2026-10-12',
      description: 'APPLECARD GSBANK PAYMENT',
      category: 'LOAN_PAYMENTS',
      categoryDetail: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    });
    expect(matchInternal([out], accounts).get(out.id)).toEqual({ kind: 'card_payment', pairId: null, by: 'category' });
    expect(summarize([out]).outCents).toBe(0);
  });

  it('keeps a kind saved on the row', () => {
    const out = tx({ accountId: 'chk', amountCents: -7_000, postedOn: '2026-10-12', internalKind: 'transfer' });
    expect(classify(out, accounts[0], matchInternal([out], accounts))).toBe('internal');
  });

  it('pairs each half once', () => {
    const outA = tx({ accountId: 'chk', amountCents: -2_500, postedOn: '2026-10-01', description: 'Payment' });
    const outB = tx({ accountId: 'chk', amountCents: -2_500, postedOn: '2026-10-02', description: 'Payment' });
    const into = tx({ accountId: 'card', amountCents: 2_500, postedOn: '2026-10-02', description: 'Payment' });
    const found = matchInternal([outA, outB, into], accounts);
    expect([found.has(outA.id), found.has(outB.id)].filter(Boolean)).toHaveLength(1);
  });
});

describe('refunds', () => {
  it('lands a refund in the month refunded, not the month charged', () => {
    const charge = tx({ accountId: 'card', amountCents: -8_000, postedOn: '2026-09-20', merchant: 'REI', category: 'GENERAL_MERCHANDISE' });
    const refund = tx({ accountId: 'card', amountCents: 8_000, postedOn: '2026-10-04', merchant: 'REI', category: 'GENERAL_MERCHANDISE' });
    const other = tx({ accountId: 'card', amountCents: -2_000, postedOn: '2026-10-10', merchant: 'Cafe' });

    const october = summarize([charge, refund, other]);
    expect(october.outCents).toBe(2_000);
    expect(october.refundCents).toBe(8_000);
    expect(october.spentCents).toBe(-6_000);

    const september = summarize([charge, refund, other], { start: '2026-09-01', end: '2026-09-30' });
    expect(september.spentCents).toBe(8_000);

    const sep = october.months.find((m) => m.month === '2026-09');
    const oct = october.months.find((m) => m.month === '2026-10');
    expect(sep).toMatchObject({ outCents: 8_000, refundCents: 0, spentCents: 8_000 });
    expect(oct).toMatchObject({ outCents: 2_000, refundCents: 8_000, spentCents: -6_000 });
  });

  it('reads money from a merchant into checking as a refund, and pay as income', () => {
    const internal = new Map();
    expect(classify(tx({ accountId: 'chk', amountCents: 1_000, postedOn: '2026-10-01', merchant: 'Amazon' }), accounts[0], internal)).toBe('refund');
    expect(classify(tx({ accountId: 'chk', amountCents: 1_000, postedOn: '2026-10-01', merchant: 'Acme', category: 'INCOME' }), accounts[0], internal)).toBe('income');
    expect(classify(tx({ accountId: 'chk', amountCents: 1_000, postedOn: '2026-10-01' }), accounts[0], internal)).toBe('income');
  });

  it('skips pending rows and hidden accounts', () => {
    const internal = new Map();
    expect(classify(tx({ accountId: 'card', amountCents: -100, postedOn: '2026-10-01', pending: true }), accounts[2], internal)).toBe('skip');
    expect(classify(tx({ accountId: 'card', amountCents: -100, postedOn: '2026-10-01' }), { ...accounts[2], hidden: true }, internal)).toBe('skip');
  });
});

describe('categories and merchants', () => {
  it('groups by category label and merchant, net of refunds', () => {
    const s = summarize([
      tx({ accountId: 'card', amountCents: -1_500, postedOn: '2026-10-02', merchant: 'Blue Bottle', category: 'FOOD_AND_DRINK' }),
      tx({ accountId: 'card', amountCents: -500, postedOn: '2026-10-09', merchant: 'Blue Bottle', category: 'FOOD_AND_DRINK' }),
      tx({ accountId: 'card', amountCents: -9_000, postedOn: '2026-10-03', merchant: 'Shell', category: 'TRANSPORTATION' }),
      tx({ accountId: 'card', amountCents: 1_000, postedOn: '2026-10-04', merchant: 'Shell', category: 'TRANSPORTATION' }),
    ]);
    expect(s.categories).toEqual([
      { label: 'Transportation', cents: 8_000 },
      { label: 'Food and drink', cents: 2_000 },
    ]);
    expect(s.merchants.map((m) => [m.name, m.cents, m.charges.length])).toEqual([
      ['Shell', 8_000, 2],
      ['Blue Bottle', 2_000, 2],
    ]);
    expect(s.largest[0].cents).toBe(9_000);
  });
});

describe('orders', () => {
  it('ties a charge to the order of the same total and merchant', () => {
    const charge = tx({ accountId: 'card', amountCents: -4_299, postedOn: '2026-10-06', description: 'AMAZON MKTPL*ZX12AB', merchant: 'Amazon' });
    const other = tx({ accountId: 'card', amountCents: -4_299, postedOn: '2026-10-06', merchant: 'Target' });
    const matched = matchOrders([charge, other], [
      { id: 'o1', orderDate: '2026-10-03', totalCents: 4_299, merchantName: 'Amazon.com', cancelled: false },
      { id: 'o2', orderDate: '2026-10-03', totalCents: 4_300, merchantName: 'Amazon.com', cancelled: false },
    ]);
    expect(matched.get(charge.id)).toBe('o1');
    expect(matched.has(other.id)).toBe(false);
  });

  it('does not tie a charge to an order placed long before or cancelled', () => {
    const charge = tx({ accountId: 'card', amountCents: -1_000, postedOn: '2026-10-20', merchant: 'Etsy' });
    expect(
      matchOrders([charge], [
        { id: 'o1', orderDate: '2026-09-01', totalCents: 1_000, merchantName: 'Etsy', cancelled: false },
        { id: 'o2', orderDate: '2026-10-19', totalCents: 1_000, merchantName: 'Etsy', cancelled: true },
      ]).size,
    ).toBe(0);
  });

  it('reads merchant names loosely', () => {
    expect(sameMerchant('SQ *BLUE BOTTLE COFFEE', 'Blue Bottle Coffee')).toBe(true);
    expect(sameMerchant('Target', 'Walmart')).toBe(false);
  });
});

describe('repeating charges', () => {
  it('finds a monthly charge of about the same amount', () => {
    const found = findRepeating(
      ['2026-07-14', '2026-08-14', '2026-09-15', '2026-10-14'].map((postedOn) =>
        tx({ accountId: 'card', amountCents: -1_599, postedOn, merchant: 'Netflix' }),
      ),
      '2026-10-28',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Netflix', period: 'month', amountCents: 1_599, count: 4, nextOn: '2026-11-14' });
  });

  it('ignores irregular charges and ones that stopped', () => {
    const irregular = ['2026-07-01', '2026-07-09', '2026-09-30'].map((postedOn) =>
      tx({ accountId: 'card', amountCents: -2_000, postedOn, merchant: 'Cafe' }),
    );
    const stopped = ['2026-01-05', '2026-02-05', '2026-03-05'].map((postedOn) =>
      tx({ accountId: 'card', amountCents: -999, postedOn, merchant: 'Gym' }),
    );
    expect(findRepeating([...irregular, ...stopped], '2026-10-28')).toEqual([]);
  });
});

import { matchInternal } from '@/lib/finances/spending/internal';
import { summarizeTransactions, type TransactionSpending } from '@/lib/finances/spending/model';
import type { SpendAccount, SpendTransaction } from '@/lib/finances/spending/types';

/**
 * Spending from transactions (plan #2593.7), for the gallery: eleven months
 * of a checking account, savings and two cards after the first month with
 * nothing linked. Pay twice a month, rent, card payments and a transfer to
 * savings each month (left out), subscriptions that repeat, a refund in
 * October of a September charge, and an Amazon charge tied to its order.
 * Run through the real rules, so the gallery shows what they make of it.
 */

export const SPENDING_TODAY = '2026-10-28';

const accounts: SpendAccount[] = [
  { id: 'chk', name: 'Chase Total Checking', kind: 'checking', hidden: false, mask: '4417' },
  { id: 'sav', name: 'Chase Savings', kind: 'savings', hidden: false, mask: '9021' },
  { id: 'sapphire', name: 'Sapphire Preferred', kind: 'credit_card', hidden: false, mask: '7730' },
  { id: 'apple', name: 'Apple Card', kind: 'credit_card', hidden: false, mask: null },
];

const MONTHS = [
  '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
  '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
];

let seq = 0;
function t(
  accountId: string,
  amountCents: number,
  postedOn: string,
  description: string,
  over: Partial<SpendTransaction> = {},
): SpendTransaction {
  seq += 1;
  return {
    id: `fx${seq}`,
    accountId,
    amountCents,
    postedOn,
    description,
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

function buy(accountId: string, cents: number, on: string, merchant: string, category: string) {
  return t(accountId, -cents, on, merchant.toUpperCase(), { merchant, category });
}

function build(): SpendTransaction[] {
  const rows: SpendTransaction[] = [];
  MONTHS.forEach((month, i) => {
    const wobble = (i * 37) % 11;
    rows.push(t('chk', 385_000, `${month}-01`, 'NORTHWIND LABS PAYROLL', { category: 'INCOME', categoryDetail: 'INCOME_WAGES' }));
    rows.push(t('chk', 385_000, `${month}-15`, 'NORTHWIND LABS PAYROLL', { category: 'INCOME', categoryDetail: 'INCOME_WAGES' }));
    rows.push(buy('chk', 210_000, `${month}-02`, 'Greystar Property Management Resident Portal Payment', 'RENT_AND_UTILITIES'));
    rows.push(buy('chk', 8_400 + wobble * 120, `${month}-11`, 'PG&E', 'RENT_AND_UTILITIES'));
    rows.push(buy('sapphire', 1_599, `${month}-14`, 'Netflix', 'ENTERTAINMENT'));
    rows.push(buy('apple', 1_199, `${month}-21`, 'Spotify', 'ENTERTAINMENT'));
    rows.push(buy('sapphire', 14_250 + wobble * 900, `${month}-06`, 'Whole Foods Market', 'FOOD_AND_DRINK'));
    rows.push(buy('sapphire', 9_870 + wobble * 400, `${month}-19`, 'Trader Joe’s', 'FOOD_AND_DRINK'));
    rows.push(buy('apple', 4_620 + wobble * 210, `${month}-09`, 'Blue Bottle Coffee', 'FOOD_AND_DRINK'));
    rows.push(buy('sapphire', 6_100 + wobble * 330, `${month}-24`, 'Shell', 'TRANSPORTATION'));    // Transfer to savings and both card payments, each with its other half.
    rows.push(t('chk', -50_000, `${month}-16`, 'Online Transfer to SAV ...9021', { category: 'TRANSFER_OUT' }));
    rows.push(t('sav', 50_000, `${month}-16`, 'Online Transfer from CHK ...4417', { category: 'TRANSFER_IN' }));
    const sapphireBill = 36_000 + wobble * 1_500;
    rows.push(t('chk', -sapphireBill, `${month}-25`, 'CHASE CREDIT CRD AUTOPAY', { category: 'LOAN_PAYMENTS' }));
    rows.push(t('sapphire', sapphireBill, `${month}-26`, 'AUTOMATIC PAYMENT - THANK YOU', { category: 'LOAN_PAYMENTS' }));
    rows.push(
      t('chk', -(7_000 + wobble * 300), `${month}-27`, 'APPLECARD GSBANK PAYMENT', {
        category: 'LOAN_PAYMENTS',
        categoryDetail: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      }),
    );
  });

  rows.push(buy('sapphire', 18_995, '2026-09-12', 'REI', 'GENERAL_MERCHANDISE'));
  rows.push(t('sapphire', 18_995, '2026-10-03', 'REI #0112 RETURN', { merchant: 'REI', category: 'GENERAL_MERCHANDISE' }));
  rows.push(
    t('apple', -6_847, '2026-10-08', 'AMAZON MKTPL*ZX12AB', {
      merchant: 'Amazon',
      category: 'GENERAL_MERCHANDISE',
      orderId: 'order-amazon-1',
    }),
  );
  rows.push(buy('sapphire', 112_400, '2026-10-17', 'Alaska Airlines', 'TRAVEL'));
  rows.push(buy('apple', 23_850, '2026-10-20', 'The Home Depot', 'HOME_IMPROVEMENT'));
  rows.push(t('sapphire', -3_200, '2026-10-27', 'SQ *TARTINE BAKERY', { merchant: 'Tartine Bakery', category: 'FOOD_AND_DRINK', pending: true }));
  return rows;
}

function summarize(period: { start: string; end: string }): TransactionSpending {
  seq = 0;
  const transactions = build();
  const internal = matchInternal(transactions, accounts);
  const orderFor = new Map(
    transactions.filter((tx) => tx.orderId).map((tx) => [tx.id, tx.orderId as string]),
  );
  return summarizeTransactions({ transactions, accounts, internal, orderFor, period, today: SPENDING_TODAY });
}

/** October 2026, this month. */
export const SPENDING_THIS_MONTH = summarize({ start: '2026-10-01', end: '2026-10-31' });

/** A period before anything was linked: no charges. */
export const SPENDING_EMPTY_PERIOD = summarize({ start: '2025-11-01', end: '2025-11-30' });

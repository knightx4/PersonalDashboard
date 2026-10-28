import { assertIntegerCents, recentMonthKeys, type Period } from '@/lib/money';
import type { RecurringPeriod } from '@/lib/recurring/extraction';
import { monthlyCents } from '@/lib/recurring/view';
import { daysBetween, type InternalMatch } from './internal';
import { merchantKey } from './orders';
import type { SpendAccount, SpendTransaction } from './types';

/**
 * Spending from bank and card transactions (plan #2593.7): money in and out
 * each month, spending by category and merchant, the largest charges, and
 * charges that repeat.
 *
 * The rules are lib/money.ts's, carried over to transactions:
 *
 *   - Integer cents throughout.
 *   - Spending is money out less refunds, and a refund lands in the month it
 *     was refunded, never back in the month of the charge.
 *   - Card payments and transfers between the person's own accounts
 *     (internal.ts) are neither spending nor money in.
 *
 * What each transaction is, in classify(): pending ones wait until they post
 * (the posted row replaces them, and counting both would count it twice);
 * brokerage and loan accounts hold investment and loan flows, not spending;
 * money into a card is a refund, as is money into checking from a merchant;
 * any other money in is income.
 */

export type Flow = 'spend' | 'refund' | 'income' | 'internal' | 'skip';

const NOT_REFUND_CATEGORIES = /^(INCOME|TRANSFER_IN)/;

export function classify(
  t: SpendTransaction,
  account: Pick<SpendAccount, 'kind' | 'hidden'> | undefined,
  internal: ReadonlyMap<string, InternalMatch>,
): Flow {
  if (!account || account.hidden || t.pending) return 'skip';
  if (internal.has(t.id)) return 'internal';
  if (account.kind === 'brokerage' || account.kind === 'loan') return 'skip';
  if (t.amountCents < 0) return 'spend';
  if (t.amountCents === 0) return 'skip';
  if (account.kind === 'credit_card') return 'refund';
  if (t.merchant && !(t.category && NOT_REFUND_CATEGORIES.test(t.category))) return 'refund';
  return 'income';
}

/** A Plaid category such as FOOD_AND_DRINK as words: "Food and drink". */
export function categoryLabel(category: string | null): string {
  if (!category || !category.trim()) return 'Uncategorised';
  if (!/^[A-Z0-9_]+$/.test(category)) return category;
  const words = category.toLowerCase().split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The name a charge is listed under. */
export function merchantName(t: Pick<SpendTransaction, 'merchant' | 'description'>): string {
  return t.merchant ?? t.description;
}

export interface MonthFlow {
  /** YYYY-MM. */
  month: string;
  inCents: number;
  /** Money out, before refunds. */
  outCents: number;
  refundCents: number;
  /** outCents less refundCents: what the month cost. */
  spentCents: number;
  /** Charges and refunds in the month, so an empty month can say so. */
  count: number;
}

export interface Charge {
  id: string;
  postedOn: string;
  /** Positive: the amount spent. A refund is negative. */
  cents: number;
  name: string;
  description: string;
  accountName: string;
  categoryLabel: string;
  orderId: string | null;
}

export interface CategorySlice {
  label: string;
  cents: number;
}

export interface MerchantSlice {
  key: string;
  name: string;
  /** Net of refunds in the period. */
  cents: number;
  /** Newest first. */
  charges: Charge[];
}

export interface RepeatingCharge {
  key: string;
  name: string;
  period: RecurringPeriod;
  /** The usual amount, the median of the charges. */
  amountCents: number;
  monthlyCents: number;
  count: number;
  firstOn: string;
  lastOn: string;
  nextOn: string;
  /** The recurring payment a charge already names, when one does. */
  recurringPaymentId: string | null;
}

export interface TransactionSpending {
  period: Period;
  /** Twelve months to this one, oldest first, every month present. */
  months: MonthFlow[];
  inCents: number;
  outCents: number;
  refundCents: number;
  spentCents: number;
  /** Card payments and own-account transfers out in the period, left out. */
  internalCents: number;
  internalCount: number;
  categories: CategorySlice[];
  merchants: MerchantSlice[];
  /** The ten largest charges in the period, largest first. */
  largest: Charge[];
  /** Charges in the period tied to a Shopping order. */
  matchedCount: number;
  chargeCount: number;
  repeating: RepeatingCharge[];
}

function within(date: string, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

export function summarizeTransactions({
  transactions,
  accounts,
  internal,
  orderFor,
  period,
  today,
}: {
  transactions: readonly SpendTransaction[];
  accounts: readonly SpendAccount[];
  internal: ReadonlyMap<string, InternalMatch>;
  /** The order each charge paid for (orders.ts). */
  orderFor: ReadonlyMap<string, string>;
  period: Period;
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
}): TransactionSpending {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const keys = recentMonthKeys(today, 12);
  const monthIndex = new Map(keys.map((k, i) => [k, i]));
  const months: MonthFlow[] = keys.map((month) => ({
    month,
    inCents: 0,
    outCents: 0,
    refundCents: 0,
    spentCents: 0,
    count: 0,
  }));

  let inCents = 0;
  let outCents = 0;
  let refundCents = 0;
  let internalCents = 0;
  let internalCount = 0;
  const categories = new Map<string, number>();
  const merchants = new Map<string, MerchantSlice>();
  const charges: Charge[] = [];
  const spends: SpendTransaction[] = [];

  for (const t of transactions) {
    assertIntegerCents(t.amountCents);
    const account = accountsById.get(t.accountId);
    const flow = classify(t, account, internal);
    if (flow === 'skip' || !account) continue;
    if (flow === 'spend') spends.push(t);

    const slot = monthIndex.get(t.postedOn.slice(0, 7));
    if (slot !== undefined) {
      const m = months[slot];
      if (flow === 'income') m.inCents += t.amountCents;
      if (flow === 'spend') {
        m.outCents -= t.amountCents;
        m.count += 1;
      }
      if (flow === 'refund') {
        m.refundCents += t.amountCents;
        m.count += 1;
      }
    }

    if (!within(t.postedOn, period)) continue;
    if (flow === 'internal') {
      if (t.amountCents < 0) {
        internalCents -= t.amountCents;
        internalCount += 1;
      }
      continue;
    }
    if (flow === 'income') {
      inCents += t.amountCents;
      continue;
    }

    // A charge is positive spending; a refund takes it back.
    const cents = -t.amountCents;
    if (flow === 'spend') outCents += cents;
    else refundCents -= cents;

    const label = categoryLabel(t.category);
    categories.set(label, (categories.get(label) ?? 0) + cents);

    const name = merchantName(t);
    const key = merchantKey(name) || name.toLowerCase();
    const charge: Charge = {
      id: t.id,
      postedOn: t.postedOn,
      cents,
      name,
      description: t.description,
      accountName: account.mask ? `${account.name} ··${account.mask}` : account.name,
      categoryLabel: label,
      orderId: orderFor.get(t.id) ?? null,
    };
    charges.push(charge);
    const slice = merchants.get(key) ?? { key, name, cents: 0, charges: [] };
    slice.cents += cents;
    slice.charges.push(charge);
    merchants.set(key, slice);
  }

  for (const m of months) m.spentCents = m.outCents - m.refundCents;
  for (const slice of merchants.values()) {
    slice.charges.sort((a, b) => b.postedOn.localeCompare(a.postedOn) || b.cents - a.cents);
  }

  const spent = charges.filter((c) => c.cents > 0);
  return {
    period,
    months,
    inCents,
    outCents,
    refundCents,
    spentCents: outCents - refundCents,
    internalCents,
    internalCount,
    categories: [...categories]
      .map(([label, cents]) => ({ label, cents }))
      .filter((s) => s.cents > 0)
      .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label)),
    merchants: [...merchants.values()]
      .filter((s) => s.cents > 0)
      .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)),
    largest: [...spent].sort((a, b) => b.cents - a.cents || b.postedOn.localeCompare(a.postedOn)).slice(0, 10),
    matchedCount: spent.filter((c) => c.orderId).length,
    chargeCount: spent.length,
    repeating: findRepeating(spends, today),
  };
}

// ---------------------------------------------------------------------------
// Repeating charges
// ---------------------------------------------------------------------------

/** Days between charges each cadence allows. */
const CADENCES: { period: RecurringPeriod; min: number; max: number; needs: number }[] = [
  { period: 'week', min: 6, max: 8, needs: 4 },
  { period: 'month', min: 26, max: 35, needs: 3 },
  { period: 'quarter', min: 85, max: 97, needs: 3 },
  { period: 'year', min: 350, max: 380, needs: 2 },
];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Charges from one merchant that come at a steady interval for about the same
 * amount: a subscription or a bill found from the money rather than from
 * mail. Every gap between charges has to fit one cadence, every amount has to
 * sit within a fifth (or two dollars) of the usual one, and the last charge
 * has to be recent enough that the next is not two cadences overdue.
 */
export function findRepeating(spends: readonly SpendTransaction[], today: string): RepeatingCharge[] {
  const groups = new Map<string, SpendTransaction[]>();
  for (const t of spends) {
    if (t.amountCents >= 0) continue;
    const name = merchantName(t);
    const key = merchantKey(name) || name.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const found: RepeatingCharge[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.postedOn.localeCompare(b.postedOn));
    // Two charges on one day are one charge split, or two things bought.
    const dates = [...new Set(sorted.map((t) => t.postedOn))];
    if (dates.length < 2) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const cadence = CADENCES.find(
      (c) => dates.length >= c.needs && gaps.every((g) => g >= c.min && g <= c.max),
    );
    if (!cadence) continue;
    const amounts = sorted.map((t) => -t.amountCents);
    const usual = median(amounts);
    const tolerance = Math.max(200, Math.round(usual / 5));
    if (amounts.some((a) => Math.abs(a - usual) > tolerance)) continue;
    const last = dates[dates.length - 1];
    const nextOn = addDays(last, median(gaps));
    if (daysBetween(nextOn, today) > cadence.max) continue;
    found.push({
      key,
      name: merchantName(sorted[sorted.length - 1]),
      period: cadence.period,
      amountCents: usual,
      monthlyCents: monthlyCents(usual, cadence.period),
      count: dates.length,
      firstOn: dates[0],
      lastOn: last,
      nextOn,
      recurringPaymentId: sorted.find((t) => t.recurringPaymentId)?.recurringPaymentId ?? null,
    });
  }
  return found.sort((a, b) => a.nextOn.localeCompare(b.nextOn) || a.name.localeCompare(b.name));
}

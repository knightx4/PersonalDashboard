/**
 * What the Recurring page and the bills agenda source show, worked out from
 * the payments the loader returns (plan #1126).
 *
 * Pure, and it takes today rather than reading the clock, so each rule below
 * is tested against payments written by hand.
 */

import type { RecurringCharge, RecurringPayment } from './load';
import type { RecurringPeriod } from './extraction';

/** How many months one period is, for putting every payment on one footing. */
const MONTHS: Record<RecurringPeriod, number> = {
  week: 12 / 52,
  month: 1,
  quarter: 3,
  year: 12,
};

/**
 * How long past its next date a payment can go without a charge before the
 * page says it may have lapsed. A monthly charge is often a few days late, and
 * a yearly one can be weeks late when the card is updated.
 */
const GRACE_DAYS: Record<RecurringPeriod, number> = {
  week: 3,
  month: 7,
  quarter: 14,
  year: 30,
};
const GRACE_UNKNOWN = 7;

/** A price rise is shown for a year after it happened, then it is just the price. */
const RISE_SHOWN_DAYS = 365;

const DAY_MS = 86_400_000;

function dayNumber(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`) / DAY_MS;
}

function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

/** An amount charged every `period`, as integer cents a month. */
export function monthlyCents(amountCents: number, period: RecurringPeriod): number {
  return Math.round(amountCents / MONTHS[period]);
}

export type PriceRise = {
  fromCents: number;
  toCents: number;
  on: string;
};

/**
 * The latest change of price, when it went up.
 *
 * Reads the newest charge or price notice that recorded what it cost before.
 * A change that also changed the period (AppleCare+ moving from monthly to a
 * yearly plan) is compared a month against a month, so paying yearly is not
 * shown as a rise from $10.81 to $71.24.
 */
export function priceRise(payment: RecurringPayment, today: string): PriceRise | null {
  const charges = payment.charges; // newest first
  const index = charges.findIndex(
    (c) =>
      c.previousAmountCents != null &&
      c.amountCents != null &&
      c.currency === payment.currency &&
      (c.event === 'charge' || c.event === 'bill' || c.event === 'price_change'),
  );
  if (index < 0) return null;
  const marked = charges[index]!;
  const toCents = marked.amountCents!;
  const fromCents = marked.previousAmountCents!;
  if (daysBetween(marked.occurredOn, today) > RISE_SHOWN_DAYS) return null;

  const period = marked.period ?? payment.period;
  const before = charges
    .slice(index + 1)
    .find((c) => c.amountCents === fromCents && c.event !== 'renewal_notice');
  const beforePeriod = before?.period ?? period;

  const rose =
    period && beforePeriod && period !== beforePeriod
      ? monthlyCents(toCents, period) > monthlyCents(fromCents, beforePeriod)
      : toCents > fromCents;
  return rose ? { fromCents, toCents, on: marked.occurredOn } : null;
}

/**
 * Whether a payment's next date has gone by with no charge after it, by more
 * than the grace its period allows. The summary never rolls a next date
 * forward past today (lib/recurring/summarise.ts), so a date in the past is a
 * charge that was due and never arrived.
 */
export function mayHaveLapsed(payment: RecurringPayment, today: string): boolean {
  if (payment.status !== 'active' || !payment.nextDate) return false;
  const grace = payment.period ? GRACE_DAYS[payment.period] : GRACE_UNKNOWN;
  return daysBetween(payment.nextDate, today) > grace;
}

export type RecurringRow = {
  id: string;
  payee: string;
  kind: RecurringPayment['kind'];
  amountCents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  /** What it comes to a month, or null when the amount or period is unknown. */
  monthlyCents: number | null;
  nextDate: string | null;
  lastChargedOn: string | null;
  rise: PriceRise | null;
  /** Every email read about it, newest first, for moving charges (plan #1211). */
  charges: RecurringCharge[];
};

export type MonthlyTotal = {
  currency: string;
  cents: number;
  /** Payments in this currency that could not be counted: no amount or no period. */
  uncounted: number;
};

export type RecurringView = {
  /** Still charging, soonest next date first; those with no next date last. */
  active: RecurringRow[];
  /** Past their next date with no charge since, longest gone first. */
  lapsed: RecurringRow[];
  cancelled: RecurringRow[];
  /**
   * Left out of the total by the person (plan #1213), by name. Kept off the
   * agenda too, as decision #1219 settled: a card statement's due date is the
   * bank's to show.
   */
  ignored: RecurringRow[];
  /** What the active payments come to a month, one line per currency. */
  total: MonthlyTotal[];
  /** What the lapsed ones would add, if they are in fact still running. */
  lapsedTotal: MonthlyTotal[];
};

function row(payment: RecurringPayment, today: string): RecurringRow {
  return {
    id: payment.id,
    payee: payment.payee,
    kind: payment.kind,
    amountCents: payment.amountCents,
    currency: payment.currency,
    period: payment.period,
    monthlyCents:
      payment.amountCents != null && payment.period
        ? monthlyCents(payment.amountCents, payment.period)
        : null,
    nextDate: payment.nextDate,
    lastChargedOn: payment.lastChargedOn,
    rise: priceRise(payment, today),
    charges: payment.charges,
  };
}

function totals(rows: readonly RecurringRow[]): MonthlyTotal[] {
  const byCurrency = new Map<string, MonthlyTotal>();
  for (const entry of rows) {
    const total = byCurrency.get(entry.currency) ?? {
      currency: entry.currency,
      cents: 0,
      uncounted: 0,
    };
    if (entry.monthlyCents == null) total.uncounted += 1;
    else total.cents += entry.monthlyCents;
    byCurrency.set(entry.currency, total);
  }
  return [...byCurrency.values()].sort((a, b) => b.cents - a.cents);
}

function bySoonest(a: RecurringRow, b: RecurringRow): number {
  if (a.nextDate && b.nextDate) {
    return a.nextDate === b.nextDate
      ? a.payee.localeCompare(b.payee)
      : a.nextDate < b.nextDate
        ? -1
        : 1;
  }
  if (a.nextDate) return -1;
  if (b.nextDate) return 1;
  return a.payee.localeCompare(b.payee);
}

export function buildRecurringView(
  payments: readonly RecurringPayment[],
  today: string,
): RecurringView {
  const active: RecurringRow[] = [];
  const lapsed: RecurringRow[] = [];
  const cancelled: RecurringRow[] = [];
  const ignored: RecurringRow[] = [];

  for (const payment of payments) {
    const entry = row(payment, today);
    if (payment.status === 'ignored') ignored.push(entry);
    else if (payment.status === 'cancelled') cancelled.push(entry);
    else if (mayHaveLapsed(payment, today)) lapsed.push(entry);
    else active.push(entry);
  }

  active.sort(bySoonest);
  lapsed.sort(bySoonest);
  cancelled.sort((a, b) => a.payee.localeCompare(b.payee));
  ignored.sort((a, b) => a.payee.localeCompare(b.payee));

  return {
    active,
    lapsed,
    cancelled,
    ignored,
    total: totals(active),
    lapsedTotal: totals(lapsed),
  };
}

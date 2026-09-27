/**
 * A payment's state, worked out from every email read about it.
 *
 * Recomputed from all its charges each time one is added, rather than updated
 * in place, because the catch-up reads the mailbox newest first: the charge
 * that arrives last is usually the oldest, and an in-place update would set
 * the amount and the next date from it.
 */

import type { RecurringEvent, RecurringKind, RecurringPeriod } from './extraction';

export type ChargeRow = {
  id: string;
  event: RecurringEvent;
  amountCents: number | null;
  /** As stored. Kept for a price change, recomputed for a charge. */
  previousAmountCents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  occurredOn: string;
  dueOn: string | null;
  createdAt?: string;
};

export type PaymentSummary = {
  amountCents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  nextDate: string | null;
  status: 'active' | 'cancelled';
  lastChargedOn: string | null;
  /** Charge ids whose previous_amount_cents should change, to what. */
  previousAmounts: Map<string, number | null>;
};

const DAY_MS = 86_400_000;

function toDay(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`) / DAY_MS;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** One period on from a date, keeping the day of the month where it can. */
export function addPeriod(ymd: string, period: RecurringPeriod): string {
  if (period === 'week') return fromDay(toDay(ymd) + 7);
  const months = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** The period the gaps between charges suggest, when the mail never said. */
export function periodFromGaps(dates: readonly string[]): RecurringPeriod | null {
  const days = [...new Set(dates)].map(toDay).sort((a, b) => a - b);
  if (days.length < 2) return null;
  const gaps = days.slice(1).map((d, i) => d - days[i]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median >= 5 && median <= 9) return 'week';
  if (median >= 25 && median <= 35) return 'month';
  if (median >= 80 && median <= 100) return 'quarter';
  if (median >= 330 && median <= 400) return 'year';
  return null;
}

const PAID: ReadonlySet<RecurringEvent> = new Set(['charge', 'bill']);

function byDate(a: ChargeRow, b: ChargeRow): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  return (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1;
}

/**
 * Work out the payment from its charges.
 *
 * - amount: the latest amount any email named, charge or price notice, so a
 *   price rise announced before it is charged already shows the new price.
 * - period: the latest one an email named, else the gaps between charges.
 * - next date: the latest date an email named that is after the last charge,
 *   else the last charge plus one period, even when that is past.
 * - status: cancelled when the latest email is a cancellation.
 * - previous amounts: a subscription charge that differs from the charge
 *   before it records that charge's amount, which is what makes it a rise or
 *   a drop. Bills are left alone: an electricity bill differs every month.
 */
export function summariseCharges(
  kind: RecurringKind,
  charges: readonly ChargeRow[],
): PaymentSummary {
  const ordered = [...charges].sort(byDate);
  const previousAmounts = new Map<string, number | null>();

  let lastPaid: ChargeRow | null = null;
  for (const charge of ordered) {
    if (!PAID.has(charge.event)) continue;
    if (kind === 'subscription') {
      const previous =
        lastPaid &&
        lastPaid.amountCents != null &&
        charge.amountCents != null &&
        lastPaid.currency === charge.currency &&
        lastPaid.amountCents !== charge.amountCents
          ? lastPaid.amountCents
          : null;
      if (previous !== charge.previousAmountCents) previousAmounts.set(charge.id, previous);
    }
    lastPaid = charge;
  }

  const withAmount = ordered.filter((c) => c.amountCents != null);
  const latestAmount = withAmount.at(-1) ?? null;

  const paidDates = ordered.filter((c) => PAID.has(c.event)).map((c) => c.occurredOn);
  const named = ordered.filter((c) => c.period).at(-1)?.period ?? null;
  const period = named ?? periodFromGaps(paidDates);

  const lastChargedOn = paidDates.at(-1) ?? null;

  const latest = ordered.at(-1) ?? null;
  const cancelled = latest?.event === 'cancelled';

  let nextDate: string | null = null;
  if (!cancelled) {
    const after = lastChargedOn ?? '0000-00-00';
    const namedDates = ordered
      .map((c) => c.dueOn)
      .filter((d): d is string => Boolean(d) && (d as string) > after)
      .sort();
    nextDate = namedDates.at(-1) ?? null;
    // Not rolled forward past today: a next date in the past is a charge
    // that was due and never arrived, which is how a lapsed subscription
    // shows (plan #1126).
    if (!nextDate && lastChargedOn && period) nextDate = addPeriod(lastChargedOn, period);
  }

  return {
    amountCents: latestAmount?.amountCents ?? null,
    currency: latestAmount?.currency ?? latest?.currency ?? 'USD',
    period,
    nextDate,
    status: cancelled ? 'cancelled' : 'active',
    lastChargedOn,
    previousAmounts,
  };
}

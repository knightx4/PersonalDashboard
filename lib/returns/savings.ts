import { assertIntegerCents } from '@/lib/money';

/**
 * Saved by returning on time this year (plan #1563; docs/UI-QUALITY-SPEC.md,
 * Part 8): the refunds that came in on or before their order's return
 * deadline, within the calendar year `today` falls in.
 *
 * A refund on an order with no deadline is left out, since there was no
 * window for it to beat. Sums are integer cents, one total per currency, so
 * the figure is right to the cent and never adds dollars to euros.
 */

export interface SavingsRefund {
  id: string;
  refundedAt: string;
  amountCents: number;
  returnDeadline: string | null;
  currency: string;
}

export interface OnTimeSavings {
  currency: string;
  totalCents: number;
  /**
   * Refunds in the total recorded in the last RECENT_DAYS. Only these may
   * count up on sight; older ones were in the figure before anyone could
   * have watched it change.
   */
  recent: { id: string; cents: number }[];
}

/** How far back a refund still counts up when first seen. */
export const RECENT_DAYS = 14;

/** `date` (YYYY-MM-DD) minus `days`, as YYYY-MM-DD. */
function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function onTimeSavings(refunds: SavingsRefund[], today: string): OnTimeSavings[] {
  const year = today.slice(0, 4);
  const recentFrom = daysBefore(today, RECENT_DAYS);
  const byCurrency = new Map<string, OnTimeSavings>();
  for (const refund of refunds) {
    const refunded = refund.refundedAt.slice(0, 10);
    if (!refund.returnDeadline || refunded > refund.returnDeadline) continue;
    if (refunded.slice(0, 4) !== year || refunded > today) continue;
    if (refund.amountCents <= 0) continue;
    assertIntegerCents(refund.amountCents);
    const entry = byCurrency.get(refund.currency) ?? {
      currency: refund.currency,
      totalCents: 0,
      recent: [],
    };
    entry.totalCents += refund.amountCents;
    if (refunded >= recentFrom) entry.recent.push({ id: refund.id, cents: refund.amountCents });
    byCurrency.set(refund.currency, entry);
  }
  return [...byCurrency.values()].sort((a, b) => b.totalCents - a.totalCents);
}

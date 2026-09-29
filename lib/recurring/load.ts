import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecurringEvent, RecurringKind, RecurringPeriod } from './extraction';

/**
 * What the person pays for regularly, with each payment's charges, newest
 * first. For the Shopping page and the agenda (plan #1126). Filters by user
 * explicitly, so a service-role client from a cron reads only that person's.
 */

/**
 * 'ignored' is a payment the person left out of the monthly total (plan
 * #1213); new charges keep it (lib/recurring/store.ts).
 */
export type RecurringStatus = 'active' | 'cancelled' | 'ignored';

export type RecurringCharge = {
  id: string;
  messageId: string | null;
  event: RecurringEvent;
  amountCents: number | null;
  previousAmountCents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  occurredOn: string;
  dueOn: string | null;
};

export type RecurringPayment = {
  id: string;
  payee: string;
  kind: RecurringKind;
  senderDomain: string | null;
  amountCents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  nextDate: string | null;
  status: RecurringStatus;
  lastChargedOn: string | null;
  charges: RecurringCharge[];
};

type PaymentRow = {
  id: string;
  payee: string;
  kind: RecurringKind;
  sender_domain: string | null;
  amount_cents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  next_date: string | null;
  status: RecurringStatus;
  last_charged_on: string | null;
};

type ChargeRow = {
  id: string;
  payment_id: string;
  message_id: string | null;
  event: RecurringEvent;
  amount_cents: number | null;
  previous_amount_cents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  occurred_on: string;
  due_on: string | null;
};

export async function loadRecurringPayments(
  supabase: SupabaseClient,
  userId: string,
): Promise<RecurringPayment[]> {
  const [payments, charges] = await Promise.all([
    supabase
      .from('recurring_payments')
      .select(
        'id, payee, kind, sender_domain, amount_cents, currency, period, next_date, status, last_charged_on',
      )
      .eq('user_id', userId)
      .order('payee'),
    supabase
      .from('recurring_charges')
      .select(
        'id, payment_id, message_id, event, amount_cents, previous_amount_cents, currency, period, occurred_on, due_on',
      )
      .eq('user_id', userId)
      .order('occurred_on', { ascending: false }),
  ]);
  if (payments.error) throw new Error(`recurring payments read failed: ${payments.error.message}`);
  if (charges.error) throw new Error(`recurring charges read failed: ${charges.error.message}`);

  const byPayment = new Map<string, RecurringCharge[]>();
  for (const row of (charges.data ?? []) as ChargeRow[]) {
    const list = byPayment.get(row.payment_id) ?? [];
    list.push({
      id: row.id,
      messageId: row.message_id,
      event: row.event,
      amountCents: row.amount_cents,
      previousAmountCents: row.previous_amount_cents,
      currency: row.currency,
      period: row.period,
      occurredOn: row.occurred_on,
      dueOn: row.due_on,
    });
    byPayment.set(row.payment_id, list);
  }

  return ((payments.data ?? []) as PaymentRow[]).map((row) => ({
    id: row.id,
    payee: row.payee,
    kind: row.kind,
    senderDomain: row.sender_domain,
    amountCents: row.amount_cents,
    currency: row.currency,
    period: row.period,
    nextDate: row.next_date,
    status: row.status,
    lastChargedOn: row.last_charged_on,
    charges: byPayment.get(row.id) ?? [],
  }));
}

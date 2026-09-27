import { RecurringPaymentsView } from '@/app/shopping/recurring/recurring-view';
import type { RecurringCharge, RecurringPayment } from '@/lib/recurring/load';
import { buildRecurringView } from '@/lib/recurring/view';

/**
 * Shopping's Recurring page (plan #1126) with an ordinary mix: monthly and
 * yearly subscriptions, one with a price rise, one with no next date, a bill
 * and a rent reminder that stopped arriving, and one cancelled.
 */

const TODAY = '2026-09-27';

function charge(
  id: string,
  occurredOn: string,
  amountCents: number,
  previousAmountCents: number | null = null,
  event: RecurringCharge['event'] = 'charge',
): RecurringCharge {
  return {
    id,
    messageId: null,
    event,
    amountCents,
    previousAmountCents,
    currency: 'USD',
    period: 'month',
    occurredOn,
    dueOn: null,
  };
}

function payment(
  payee: string,
  over: Partial<RecurringPayment>,
): RecurringPayment {
  return {
    id: payee,
    payee,
    kind: 'subscription',
    senderDomain: null,
    amountCents: 999,
    currency: 'USD',
    period: 'month',
    nextDate: null,
    status: 'active',
    lastChargedOn: null,
    charges: [],
    ...over,
  };
}

const payments: RecurringPayment[] = [
  payment('Streaming Premium', {
    amountCents: 2272,
    nextDate: '2026-10-11',
    lastChargedOn: '2026-09-21',
    charges: [charge('s1', '2026-09-21', 2272), charge('s2', '2026-08-21', 2272, 2099)],
  }),
  payment('Cloud storage', { amountCents: 999, nextDate: '2026-09-30', lastChargedOn: '2026-08-30' }),
  payment('Photo backup', { amountCents: 10824, period: 'year', nextDate: '2027-01-15' }),
  payment('Online courses', { amountCents: 18000, period: 'year', nextDate: '2027-01-31' }),
  payment('Design tool', {
    amountCents: 4828,
    charges: [charge('d1', '2026-08-22', 4828, 4409, 'price_change')],
  }),
  payment('Internet', {
    kind: 'bill',
    amountCents: 9595,
    nextDate: '2026-07-21',
    lastChargedOn: '2026-06-28',
  }),
  payment('Property management', { kind: 'bill', amountCents: 132500, nextDate: '2026-06-01' }),
  payment('Language app', { status: 'cancelled', amountCents: 1299, lastChargedOn: '2026-03-12' }),
];

export function RecurringSurface() {
  return <RecurringPaymentsView view={buildRecurringView(payments, TODAY)} today={TODAY} />;
}

export function RecurringEmptySurface() {
  return <RecurringPaymentsView view={buildRecurringView([], TODAY)} today={TODAY} />;
}

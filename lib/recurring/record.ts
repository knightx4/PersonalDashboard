import { formatDay } from '@/lib/goals/dates';
import { formatMoney } from '@/lib/money';
import type { RecurringExtraction } from './extraction';

/**
 * The sentences Home reads for what the mail sync and the receipt re-read do
 * to the person's recurring payments (plan #1571, feature #1456).
 *
 * The writes themselves are recorded where they happen: fileRecurringReading
 * in ./store.ts for the sync, rereadStoreReceipts in ./reread.ts for the
 * re-read. These only word them, so the tests can read the same sentences.
 */

/** The ref a payment is recorded under. */
export function paymentRef(paymentId: string): string {
  return `public.recurring_payments:${paymentId}`;
}

function amount(cents: number, currency: string): string {
  try {
    return formatMoney(cents, currency);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** What the email was about, as "a $15.49 charge on 21 Sept". */
export function mailPhrase(reading: Pick<RecurringExtraction, 'event' | 'amountCents' | 'currency' | 'occurredOn'>): string {
  const sum = reading.amountCents !== null ? amount(reading.amountCents, reading.currency) : null;
  const on = formatDay(reading.occurredOn);
  switch (reading.event) {
    case 'charge':
      return sum ? `a ${sum} charge on ${on}` : `a charge on ${on}`;
    case 'bill':
      return sum ? `a ${sum} bill sent ${on}` : `a bill sent ${on}`;
    case 'renewal_notice':
      return `a renewal notice sent ${on}`;
    case 'price_change':
      return sum ? `a price change to ${sum}, sent ${on}` : `a price change sent ${on}`;
    case 'trial_ending':
      return `a trial ending, sent ${on}`;
    case 'cancelled':
      return `a cancellation sent ${on}`;
  }
}

/** A payment the sync added from an email. */
export function addedSummary(payee: string, reading: RecurringExtraction, ignored: boolean): string {
  const left = ignored ? ' It reads as a card statement, so it is left out of the monthly total.' : '';
  return `Dash added ${payee} to your recurring payments, from an email about ${mailPhrase(reading)}.${left}`;
}

/** A payment the sync worked out again after filing another email on it. */
export function updatedSummary(payee: string, reading: RecurringExtraction): string {
  return `Dash updated ${payee} in your recurring payments, from an email about ${mailPhrase(reading)}.`;
}

/**
 * Why a payment's update has no Undo: putting its old amount back would
 * leave the new charge filed on it, and the next email would work the amount
 * out again from every charge.
 */
export const UPDATED_NO_UNDO =
  'There is no Undo, because its amount and dates come from every charge filed on it. If the charge belongs to another payment, move it on the Recurring page.';

/** A charge the re-read moved off a store's name onto the service it paid for. */
export function movedSummary(opts: {
  store: string;
  payee: string;
  amountCents: number | null;
  currency: string;
  occurredOn: string;
  storeRemoved: boolean;
}): string {
  const sum = opts.amountCents !== null ? `${amount(opts.amountCents, opts.currency)} ` : '';
  const removed = opts.storeRemoved ? ` ${opts.store} had nothing left on it, so Dash removed it.` : '';
  return `Dash read a receipt again and moved its ${sum}charge of ${formatDay(opts.occurredOn)} from ${opts.store} to ${opts.payee}.${removed}`;
}

/** Why a move has no Undo: it changed the charge and both payments at once. */
export const MOVED_NO_UNDO =
  'There is no Undo, because the move changed the charge and both payments at once. To put it back, move the charge on the Recurring page.';

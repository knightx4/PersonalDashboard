import type { RecurringEvent } from './extraction';

/**
 * The bill gate as one question for Jev (plan #1167).
 *
 * Haiku's prompt in extract.ts asks two things before it reads any fields:
 * whether the email is about a payment made regularly, and if so which of
 * the six events it reports. Jev answers both at once by picking one of the
 * six events or `not_recurring`. The meanings are the ones Haiku is given.
 *
 * Jev reads what Haiku reads: sender, subject and the first 10,000
 * characters of the body.
 */

export type RecurringGateLabel = RecurringEvent | 'not_recurring';

export const RECURRING_OPTIONS: Readonly<Record<RecurringGateLabel, string>> = {
  charge: 'The person was charged or paid for it: a receipt.',
  bill: 'A bill or statement is ready or due.',
  renewal_notice: 'It will renew or charge soon.',
  price_change: 'The price is changing.',
  trial_ending: 'A free trial ends.',
  cancelled: 'It was cancelled or will end.',
  not_recurring:
    'Not about a payment the person makes regularly: a one-off purchase or order, a refund, a newsletter or marketing with no payment of theirs in it, a job application, or anything else.',
};

export const RECURRING_QUESTION = {
  type: 'choice',
  question:
    'This email may be about something the person pays for regularly: a subscription, a membership, or a bill (phone, broadband, power, water, insurance, rent, a loan). What does it report?',
  options: RECURRING_OPTIONS,
} as const;

/** The same cut the Haiku call makes. */
export const RECURRING_BODY_CHARS = 10_000;

export function recurringState(email: {
  fromAddress: string | null;
  subject: string;
  text: string;
}): Record<string, string> {
  return {
    from: email.fromAddress ?? 'unknown',
    subject: email.subject,
    body: email.text.slice(0, RECURRING_BODY_CHARS),
  };
}

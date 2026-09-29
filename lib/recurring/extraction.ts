/**
 * What reading one recurring-payment email produces, and the reading that
 * needs no model.
 *
 * The model's answer is checked here (parseRecurringExtraction) rather than
 * trusted, and the heuristic below is what runs when there is no API key or
 * the model's answer does not check out. Both are pure, so the saved messages
 * in fixtures/emails/recurring are read by the same code the sync runs.
 */

import { z } from 'zod';
import { extractCurrencyCode } from '@/lib/email/extract/currency';
import { parseLooseCalendarDate } from '@/lib/email/extract/email-dates';
import { displayNameFromAddress, parseMoneyToCents } from '@/lib/email/extract/heuristic';
import { PAYEE_MAX } from './limits';
import type { RecurringHint } from './rules';

export const RECURRING_EVENTS = [
  'charge',
  'bill',
  'renewal_notice',
  'price_change',
  'trial_ending',
  'cancelled',
] as const;
export type RecurringEvent = (typeof RECURRING_EVENTS)[number];

export const RECURRING_PERIODS = ['week', 'month', 'quarter', 'year'] as const;
export type RecurringPeriod = (typeof RECURRING_PERIODS)[number];

export type RecurringKind = 'subscription' | 'bill';

export type RecurringExtraction = {
  payee: string;
  kind: RecurringKind;
  event: RecurringEvent;
  /** Integer cents in `currency`; null for a notice that names no amount. */
  amountCents: number | null;
  /** For a price change: what it cost before. */
  previousAmountCents: number | null;
  currency: string;
  period: RecurringPeriod | null;
  /** YYYY-MM-DD: the charge date, or the email's date for a notice. */
  occurredOn: string;
  /** YYYY-MM-DD: the renewal, due or effective date the email names. */
  dueOn: string | null;
};

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

const cents = z.number().int().min(0).max(100_000_000).nullable().optional();

const ModelAnswer = z.object({
  payee: z.string().trim().min(1).max(PAYEE_MAX),
  kind: z.enum(['subscription', 'bill']),
  event: z.enum(RECURRING_EVENTS),
  amountCents: cents,
  previousAmountCents: cents,
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .nullable()
    .optional(),
  period: z.enum(RECURRING_PERIODS).nullable().optional(),
  occurredOn: ymd,
  dueOn: ymd,
});

/**
 * Check the model's JSON. Null when it said "not recurring" or the answer does
 * not hold together; `notRecurring` tells the two apart.
 */
export function parseRecurringExtraction(
  raw: unknown,
  fallbackDate: string,
): { ok: true; value: RecurringExtraction } | { ok: false; notRecurring: boolean } {
  if (raw && typeof raw === 'object' && 'error' in raw) {
    return { ok: false, notRecurring: (raw as { error: unknown }).error === 'not_recurring' };
  }
  const parsed = ModelAnswer.safeParse(raw);
  if (!parsed.success) return { ok: false, notRecurring: false };
  const a = parsed.data;
  // A charge or a bill with no amount is a reading that went wrong, not a fact.
  if ((a.event === 'charge' || a.event === 'bill') && a.amountCents == null) {
    return { ok: false, notRecurring: false };
  }
  return {
    ok: true,
    value: {
      payee: a.payee,
      kind: a.kind,
      event: a.event,
      amountCents: a.amountCents ?? null,
      previousAmountCents: a.previousAmountCents ?? null,
      currency: (a.currency ?? 'USD').toUpperCase(),
      period: a.period ?? null,
      occurredOn: a.occurredOn ?? fallbackDate,
      dueOn: a.dueOn ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// The heuristic.
// ---------------------------------------------------------------------------

const MONEY = String.raw`(?:US\$|\$|£|€|HK\$|C\$|A\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d{1,3}(?:,\d{3})*\.\d{2}\s?(?:USD|GBP|EUR)`;

const DATE = String.raw`(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})`;

function symbolCurrency(amount: string): string | null {
  if (/HK\$/.test(amount)) return 'HKD';
  if (/C\$/.test(amount)) return 'CAD';
  if (/A\$/.test(amount)) return 'AUD';
  if (/£|GBP/.test(amount)) return 'GBP';
  if (/€|EUR/.test(amount)) return 'EUR';
  return null;
}

/**
 * The amount the email is about. A labelled total first ("Total", "Amount
 * due", "You were charged"), then the first amount followed by a period
 * ("$15.49/month"), then the first amount at all.
 */
export function findAmount(text: string): { cents: number; raw: string } | null {
  const labelled = new RegExp(
    String.raw`(?:total(?:\s+(?:charged|due|paid|amount))?|amount(?:\s+(?:due|charged|paid))?|you (?:were|will be) charged|charged|new balance|balance due|payment of|you paid)[^\d$£€\n]{0,30}(${MONEY})`,
    'i',
  );
  const periodic = new RegExp(String.raw`(${MONEY})\s*(?:\/|per|a|each)\s*(?:mo|month|yr|year|week|quarter)`, 'i');
  const any = new RegExp(`(${MONEY})`);

  for (const re of [labelled, periodic, any]) {
    const match = text.match(re);
    if (match?.[1]) {
      const cents = parseMoneyToCents(match[1]);
      if (cents != null && cents > 0) return { cents, raw: match[1] };
    }
  }
  return null;
}

export function findPeriod(text: string): RecurringPeriod | null {
  if (/\b(?:annual(?:ly)?|yearly|per year|\/\s?(?:yr|year)|a year|12[- ]month)\b/i.test(text)) return 'year';
  if (/\b(?:quarterly|per quarter|every 3 months)\b/i.test(text)) return 'quarter';
  if (/\b(?:weekly|per week|\/\s?week|every week)\b/i.test(text)) return 'week';
  if (/\b(?:monthly|per month|\/\s?mo(?:nth)?|a month|each month|every month|billing period)\b/i.test(text)) return 'month';
  return null;
}

/** The first date after one of the labels, as YYYY-MM-DD. */
function dateAfter(text: string, labels: string, year: number): string | null {
  // Up to a few words between the label and the date: "next billing date is
  // October 3", "starts on your billing date on October 14".
  const re = new RegExp(`\\b(?:${labels})\\b[^\\d]{0,40}?(${DATE})`, 'i');
  const match = text.match(re);
  return match?.[1] ? parseLooseCalendarDate(match[1], year) : null;
}

/**
 * What the email is about, from its subject and body, when no model reads it.
 * Asks more of the email than the model does: it needs an amount unless the
 * message is a cancellation or names a date, and it gives up otherwise.
 */
export function heuristicRecurring(input: {
  subject: string;
  text: string;
  fromAddress: string | null;
  receivedOn: string;
  hint: RecurringHint;
}): RecurringExtraction | null {
  const blob = `${input.subject}\n${input.text}`;
  const year = Number(input.receivedOn.slice(0, 4));
  const payee = payeeFrom(input);
  if (!payee) return null;

  const amount = findAmount(input.text) ?? findAmount(input.subject);
  const period = findPeriod(blob);
  const currency =
    extractCurrencyCode(blob) ?? (amount ? symbolCurrency(amount.raw) : null) ?? 'USD';

  const due = dateAfter(
    blob,
    'renews|will renew|renewal date|next (?:billing|payment|charge) date|next bill(?:ing)?|due(?: date)?|payment due|will be charged|trial ends|effective|starts|starting|begins|beginning',
    year,
  );
  const charged =
    dateAfter(blob, 'charged|billed|payment date|date paid|paid on|invoice date|statement date', year) ??
    input.receivedOn;

  let event: RecurringEvent;
  if (input.hint === 'cancelled') event = 'cancelled';
  else if (input.hint === 'price_change') event = 'price_change';
  else if (/\btrial\b/i.test(input.subject)) event = 'trial_ending';
  else if (input.hint === 'bill') event = 'bill';
  else if (/\b(?:will renew|renews (?:on|soon)|upcoming|reminder)\b/i.test(input.subject)) {
    event = 'renewal_notice';
  } else event = 'charge';

  if ((event === 'charge' || event === 'bill') && !amount) return null;

  let previousAmountCents: number | null = null;
  if (event === 'price_change') {
    const change = blob.match(new RegExp(`from\\s+(${MONEY})[^\\n]{0,40}?\\bto\\s+(${MONEY})`, 'i'));
    if (change) {
      previousAmountCents = parseMoneyToCents(change[1]);
      const next = parseMoneyToCents(change[2]);
      return {
        payee,
        kind: 'subscription',
        event,
        amountCents: next,
        previousAmountCents,
        currency,
        period,
        occurredOn: input.receivedOn,
        dueOn: due,
      };
    }
  }

  return {
    payee,
    kind: event === 'bill' || input.hint === 'bill' ? 'bill' : 'subscription',
    event,
    amountCents: amount?.cents ?? null,
    previousAmountCents,
    currency,
    period,
    occurredOn: event === 'charge' || event === 'bill' ? charged : input.receivedOn,
    dueOn: due,
  };
}

/**
 * The payee when no model names it: the sender's display name, less the
 * "Billing" and "Team" padding senders add, else the domain's first label.
 */
export function payeeFrom(input: { fromAddress: string | null; subject: string }): string | null {
  const fromSubject = input.subject.match(/\byour (?:\w+ )?receipt from ([^#.\n]+?)(?:\s*#|\.|$)/i);
  if (fromSubject?.[1]) return fromSubject[1].trim();

  const display = displayNameFromAddress(input.fromAddress);
  if (display) {
    const cleaned = display
      .replace(/\b(?:billing|team|support|payments?|no-?reply|customer (?:care|service)|accounts?|notifications?)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,|:-]+|[\s,|:-]+$/g, '')
      .trim();
    if (cleaned) return cleaned;
  }
  const domain = input.fromAddress?.toLowerCase().match(/@([a-z0-9-]+\.)*?([a-z0-9-]+)\.[a-z]{2,}>?$/);
  if (domain?.[2]) return domain[2].charAt(0).toUpperCase() + domain[2].slice(1);
  return null;
}

/**
 * How mail about the same thing finds the same row: lowercase letters and
 * digits only, with the company suffixes dropped.
 */
export function payeeKey(payee: string): string {
  const key = payee
    .toLowerCase()
    .replace(/\b(?:inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|com|the)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 120);
  return key || payee.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120) || 'unknown';
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { unwrapQuotedOriginal } from '@/lib/email/extract/forwarded';
import { decideWithJev } from '@/lib/jev/decide';
import {
  heuristicRecurring,
  looksLikeCardStatement,
  namesTheStore,
  parseRecurringExtraction,
  type RecurringEvent,
  type RecurringExtraction,
} from './extraction';
import { RECURRING_QUESTION, recurringState } from './jev-question';
import type { RecurringHint } from './rules';
import { MODELS } from '@/lib/core/models';

/**
 * Reading a claimed email's body into a recurring payment.
 *
 * Haiku, one call per claimed email, as extract-order does for orders. The
 * rules already decided the email is probably about something paid for
 * regularly; the model decides whether it really is and reads the numbers.
 * Without a key, or when its answer does not hold together, the heuristic
 * reads what it can.
 *
 * For an account that has opted in, Jev answers the gate first (plan #1167):
 * whether the email is a recurring payment and which event it reports. See
 * extractRecurringFromEmail.
 */

const EXTRACT_MODEL = MODELS.recurringExtract;

const SYSTEM = `You read one email about something a person pays for regularly: a subscription, a membership, or a bill (phone, broadband, power, water, insurance, rent, a loan).
Return ONLY a JSON object with these fields:
- payee: the service or company being paid, as the person would name it ("Netflix", "Con Edison", "iCloud+"). For a receipt from Apple, Google Play, PayPal or Stripe, name the service billed, not the store or processor.
- kind: "subscription" for a service or membership with a set price; "bill" for a utility, phone, insurance, rent or loan bill whose amount can vary.
- event: one of
  "charge" (you were charged or paid; a receipt),
  "bill" (a bill or statement is ready or due),
  "renewal_notice" (it will renew or charge soon),
  "price_change" (the price is changing),
  "trial_ending" (a free trial ends),
  "cancelled" (it was cancelled or will end).
- amountCents: integer cents of the amount charged, due, or the new price. null only when the email names no amount.
- previousAmountCents: for a price_change, the old price in integer cents; otherwise null.
- currency: ISO 4217 code (USD, GBP, EUR, …). USD when unstated.
- period: "week", "month", "quarter" or "year" when the email says how often; else null.
- occurredOn: YYYY-MM-DD of the charge or bill; for a notice, the email's date.
- dueOn: YYYY-MM-DD the email names for the next renewal, the due date, the trial end, or when a new price starts; else null.
- cardStatement: true when the email is a credit card statement ("Your credit card statement is available", a statement balance and a minimum payment due); else false. For a card statement, payee is the card as the person would name it ("Chase Sapphire", "Amex Gold"), kind is "bill", event is "bill", and amountCents is the statement balance.

Money is integer cents only (15.49 becomes 1549).
If the email is a one-off purchase or order, a refund, a newsletter or marketing with no payment of theirs in it, a job application, or anything else that is not about a payment they make regularly, return {"error":"not_recurring"}.`;

export type RecurringReading =
  | { ok: true; value: RecurringExtraction; source: 'llm' | 'heuristic' }
  | { ok: false; notRecurring: boolean; reason: string };

type Email = { subject: string; text: string; fromAddress: string | null };

export type RecurringHaikuInput = {
  email: Email;
  receivedOn: string;
  apiKey?: string | null;
  onSpend?: SpendSink;
};

/**
 * Haiku's reading, checked. Null when there is no key, the call failed, or
 * the answer had no JSON in it.
 */
export type RecurringHaikuReading = ReturnType<typeof parseRecurringExtraction> | null;

export async function readRecurringWithHaiku(
  input: RecurringHaikuInput,
): Promise<RecurringHaikuReading> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { email } = input;
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Email date: ${input.receivedOn}\nFrom: ${email.fromAddress ?? ''}\nSubject: ${email.subject}\n\nBody:\n${email.text.slice(0, 10_000)}`,
        },
      ],
    });
    input.onSpend?.({ model: EXTRACT_MODEL, usage: usageFrom(message.usage) });
    const block = message.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text : '';
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return null;
    return parseRecurringExtraction(JSON.parse(json[0]) as unknown, input.receivedOn);
  } catch (err) {
    console.error('recurring extract failed', err);
    return null;
  }
}

/**
 * A reading with the event Jev settled. Null when the result no longer holds
 * together: a charge or a bill needs an amount, as parseRecurringExtraction
 * requires of Haiku.
 */
function withEvent(value: RecurringExtraction, event: RecurringEvent): RecurringExtraction | null {
  if ((event === 'charge' || event === 'bill') && value.amountCents == null) return null;
  return { ...value, event };
}

/** What the gate gives back: Jev's event (null for "not one"), or the whole Haiku path. */
type Gated = { by: 'jev'; event: RecurringEvent | null } | { by: 'haiku'; reading: RecurringReading };

/**
 * Reads one claimed email into a recurring payment.
 *
 * 1. Jev is asked whether the email is a recurring payment and which of the
 *    six events it reports, unless the account has not opted in
 *    (`jevEnabled`, from lib/jev/enabled.ts), in which case nothing is sent.
 * 2. Its answer stands at 0.8 confidence or more. Otherwise, or when Jev
 *    fails, this is the Haiku call it always was, with the heuristic behind it.
 * 3. A sure "not recurring" ends it: Haiku is not called. A sure event still
 *    needs Haiku for the payee, amount and dates; Jev's event replaces
 *    Haiku's, and when Haiku cannot read the fields the heuristic does.
 *
 * Jev's spend goes to the same `onSpend` as Haiku's.
 */
export async function extractRecurringFromEmail(input: ExtractInput): Promise<RecurringReading> {
  const reading = await readRecurring(input);
  if (!reading.ok || reading.value.cardStatement) return reading;
  // The text decides too: a card statement the model did not flag is still
  // one, and files as not counted (plan #1214).
  const email = unwrapQuotedOriginal(input);
  return looksLikeCardStatement(email)
    ? { ...reading, value: { ...reading.value, cardStatement: true } }
    : reading;
}

type ExtractInput = {
  subject: string;
  text: string;
  fromAddress: string | null;
  /** YYYY-MM-DD the email arrived, for a notice with no date of its own. */
  receivedOn: string;
  hint: RecurringHint;
  apiKey?: string | null;
  onSpend?: SpendSink;
  /** False, the default, for an account that has not opted in; Jev is then never called. */
  jevEnabled?: boolean;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
  /** Haiku's reading; replaced in tests. */
  haiku?: (input: RecurringHaikuInput) => Promise<RecurringHaikuReading>;
};

async function readRecurring(input: ExtractInput): Promise<RecurringReading> {
  // A forwarded receipt is read as the original.
  const email = unwrapQuotedOriginal(input);
  // A reading that files a store's receipt under the store is no reading:
  // it falls to the heuristic, which refuses it too (plan #1212).
  const readHaiku = async (): Promise<RecurringHaikuReading> => {
    const read = await (input.haiku ?? readRecurringWithHaiku)({
      email,
      receivedOn: input.receivedOn,
      apiKey: input.apiKey,
      onSpend: input.onSpend,
    });
    if (read?.ok && namesTheStore(read.value.payee, email.fromAddress)) {
      return { ok: false, notRecurring: false };
    }
    return read;
  };
  const heuristic = () =>
    heuristicRecurring({
      subject: email.subject,
      text: email.text,
      fromAddress: email.fromAddress,
      receivedOn: input.receivedOn,
      hint: input.hint,
    });

  // The path every email took before Jev, and still takes when Jev is unsure.
  const haikuPath = async (): Promise<RecurringReading> => {
    const read = await readHaiku();
    if (read?.ok) return { ok: true, value: read.value, source: 'llm' };
    if (read?.notRecurring) return { ok: false, notRecurring: true, reason: 'not_recurring' };
    const guessed = heuristic();
    if (guessed) return { ok: true, value: guessed, source: 'heuristic' };
    return { ok: false, notRecurring: false, reason: 'no_extraction' };
  };

  const decided = await decideWithJev<typeof RECURRING_QUESTION, Gated>({
    state: recurringState(email),
    question: RECURRING_QUESTION,
    enabled: input.jevEnabled ?? false,
    read: (answer) => ({ by: 'jev', event: answer.choice === 'not_recurring' ? null : answer.choice }),
    fallback: async () => ({ by: 'haiku', reading: await haikuPath() }),
    onSpend: input.onSpend,
    apiKey: input.jevApiKey,
    fetch: input.jevFetch,
  });

  if (decided.value.by === 'haiku') return decided.value.reading;

  const { event } = decided.value;
  if (!event) return { ok: false, notRecurring: true, reason: 'not_recurring' };

  const read = await readHaiku();
  const fromHaiku = read?.ok ? withEvent(read.value, event) : null;
  if (fromHaiku) return { ok: true, value: fromHaiku, source: 'llm' };
  const guessed = heuristic();
  const fromHeuristic = guessed ? withEvent(guessed, event) : null;
  if (fromHeuristic) return { ok: true, value: fromHeuristic, source: 'heuristic' };
  return { ok: false, notRecurring: false, reason: 'no_extraction' };
}

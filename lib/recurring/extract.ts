import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { unwrapQuotedOriginal } from '@/lib/email/extract/forwarded';
import {
  heuristicRecurring,
  parseRecurringExtraction,
  type RecurringExtraction,
} from './extraction';
import type { RecurringHint } from './rules';

/**
 * Reading a claimed email's body into a recurring payment.
 *
 * Haiku, one call per claimed email, as extract-order does for orders. The
 * rules already decided the email is probably about something paid for
 * regularly; the model decides whether it really is and reads the numbers.
 * Without a key, or when its answer does not hold together, the heuristic
 * reads what it can.
 */

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

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

Money is integer cents only (15.49 becomes 1549).
If the email is a one-off purchase or order, a refund, a newsletter or marketing with no payment of theirs in it, a job application, or anything else that is not about a payment they make regularly, return {"error":"not_recurring"}.`;

export type RecurringReading =
  | { ok: true; value: RecurringExtraction; source: 'llm' | 'heuristic' }
  | { ok: false; notRecurring: boolean; reason: string };

export async function extractRecurringFromEmail(input: {
  subject: string;
  text: string;
  fromAddress: string | null;
  /** YYYY-MM-DD the email arrived, for a notice with no date of its own. */
  receivedOn: string;
  hint: RecurringHint;
  apiKey?: string | null;
  onSpend?: SpendSink;
}): Promise<RecurringReading> {
  // A forwarded receipt is read as the original.
  const email = unwrapQuotedOriginal(input);
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
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
      if (json) {
        const parsed = parseRecurringExtraction(JSON.parse(json[0]) as unknown, input.receivedOn);
        if (parsed.ok) return { ok: true, value: parsed.value, source: 'llm' };
        if (parsed.notRecurring) {
          return { ok: false, notRecurring: true, reason: 'not_recurring' };
        }
      }
    } catch (err) {
      console.error('recurring extract failed', err);
    }
  }

  const heuristic = heuristicRecurring({
    subject: email.subject,
    text: email.text,
    fromAddress: email.fromAddress,
    receivedOn: input.receivedOn,
    hint: input.hint,
  });
  if (heuristic) return { ok: true, value: heuristic, source: 'heuristic' };
  return { ok: false, notRecurring: false, reason: 'no_extraction' };
}

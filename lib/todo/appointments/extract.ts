import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { unwrapQuotedOriginal } from '@/lib/email/extract/forwarded';
import {
  heuristicAppointment,
  parseAppointmentExtraction,
  type AppointmentExtraction,
} from './extraction';
import type { AppointmentHint } from './rules';

/**
 * Reading a claimed email's body into an appointment.
 *
 * Haiku, one call per claimed email, as the recurring-payments linker does
 * for bills. The rules already decided the email is probably about a booking;
 * the model decides whether it really is and reads the day, time and place.
 * Without a key, or when its answer does not hold together, the heuristic
 * reads what it can.
 */

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = `You read one email about an appointment or reservation a person has booked: a doctor, dentist or therapist, a haircut or spa, a class or session, a restaurant table, a repair or service visit.
Return ONLY a JSON object with these fields:
- event: "booked" (a new booking is confirmed), "rescheduled" (it moved to a new time), "cancelled" (it will no longer happen), or "reminder" (a reminder of a booking already made).
- title: what it is, in a few words, as the person would put it on a calendar ("Dental cleaning", "Haircut", "Dinner for 2", "Physio").
- provider: who it is with or where: the practice, salon, restaurant or person ("Smile Dental", "Lilia"). null if the email does not say.
- reference: the confirmation or booking number, or null.
- date: YYYY-MM-DD of the appointment (for a change, the new day). For a cancellation, the day that was cancelled, or null if not given.
- time: HH:MM in 24-hour time, as printed in the email, or null if only a day is given.
- endTime: HH:MM when the email gives an end time, else null.
- location: the address or place, one line, or null. For a video visit, "Video visit".
- previousDate, previousTime: for a change, the day and time it was moved from; otherwise null.

Use the email's date to place a day with no year.
If the email is not about a specific appointment of theirs (marketing, a newsletter, a review request, a receipt for a visit already past, a flight, a hotel stay, an order or delivery, a job interview, a calendar invitation from a person), return {"error":"not_appointment"}.`;

export type AppointmentReading =
  | { ok: true; value: AppointmentExtraction; source: 'llm' | 'heuristic' }
  | { ok: false; notAppointment: boolean; reason: string };

export async function extractAppointmentFromEmail(input: {
  subject: string;
  text: string;
  fromAddress: string | null;
  /** YYYY-MM-DD the email arrived, for a day printed with no year. */
  receivedOn: string;
  hint: AppointmentHint;
  apiKey?: string | null;
  onSpend?: SpendSink;
}): Promise<AppointmentReading> {
  // A forwarded confirmation is read as the original.
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
        const parsed = parseAppointmentExtraction(JSON.parse(json[0]) as unknown);
        if (parsed.ok) return { ok: true, value: parsed.value, source: 'llm' };
        if (parsed.notAppointment) {
          return { ok: false, notAppointment: true, reason: 'not_appointment' };
        }
      }
    } catch (err) {
      console.error('appointment extract failed', err);
    }
  }

  const heuristic = heuristicAppointment({
    subject: email.subject,
    text: email.text,
    fromAddress: email.fromAddress,
    receivedOn: input.receivedOn,
    hint: input.hint,
  });
  if (heuristic) return { ok: true, value: heuristic, source: 'heuristic' };
  return { ok: false, notAppointment: false, reason: 'no_extraction' };
}

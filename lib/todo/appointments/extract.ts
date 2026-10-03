import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { unwrapQuotedOriginal } from '@/lib/email/extract/forwarded';
import { decideWithJev } from '@/lib/jev/decide';
import {
  heuristicAppointment,
  parseAppointmentExtraction,
  type AppointmentEvent,
  type AppointmentExtraction,
} from './extraction';
import { APPOINTMENT_QUESTION, appointmentState } from './jev-question';
import type { AppointmentHint } from './rules';
import { MODELS } from '@/lib/core/models';

/**
 * Reading a claimed email's body into an appointment.
 *
 * Haiku, one call per claimed email, as the recurring-payments linker does
 * for bills. The rules already decided the email is probably about a booking;
 * the model decides whether it really is and reads the day, time and place.
 * Without a key, or when its answer does not hold together, the heuristic
 * reads what it can.
 *
 * For an account that has opted in, Jev answers the gate first (plan #1167):
 * whether the email is an appointment and which event it reports. See
 * extractAppointmentFromEmail.
 */

const EXTRACT_MODEL = MODELS.appointmentsExtract;

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

type Email = { subject: string; text: string; fromAddress: string | null };

export type AppointmentHaikuInput = {
  email: Email;
  receivedOn: string;
  apiKey?: string | null;
  onSpend?: SpendSink;
};

/**
 * Haiku's reading, checked. Null when there is no key, the call failed, or
 * the answer had no JSON in it.
 */
export type AppointmentHaikuReading = ReturnType<typeof parseAppointmentExtraction> | null;

export async function readAppointmentWithHaiku(
  input: AppointmentHaikuInput,
): Promise<AppointmentHaikuReading> {
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
    return parseAppointmentExtraction(JSON.parse(json[0]) as unknown);
  } catch (err) {
    console.error('appointment extract failed', err);
    return null;
  }
}

/**
 * A reading with the event Jev settled. Null when the result no longer holds
 * together: anything but a cancellation needs a day, as
 * parseAppointmentExtraction requires of Haiku.
 */
function withEvent(value: AppointmentExtraction, event: AppointmentEvent): AppointmentExtraction | null {
  if (!value.date && event !== 'cancelled') return null;
  return { ...value, event };
}

/** What the gate gives back: Jev's event (null for "not one"), or the whole Haiku path. */
type Gated = { by: 'jev'; event: AppointmentEvent | null } | { by: 'haiku'; reading: AppointmentReading };

/**
 * Reads one claimed email into an appointment.
 *
 * 1. Jev is asked whether the email is an appointment of the person's and
 *    which of the four events it reports, unless the account has not opted in
 *    (`jevEnabled`, from lib/jev/enabled.ts), in which case nothing is sent.
 * 2. Its answer stands at 0.8 confidence or more. Otherwise, or when Jev
 *    fails, this is the Haiku call it always was, with the heuristic behind it.
 * 3. A sure "not an appointment" ends it: Haiku is not called. A sure event
 *    still needs Haiku for the day, time, provider and place; Jev's event
 *    replaces Haiku's, and when Haiku cannot read the fields the heuristic
 *    does, taking Jev's event in place of the subject's hint.
 *
 * Jev's spend goes to the same `onSpend` as Haiku's.
 */
export async function extractAppointmentFromEmail(input: {
  subject: string;
  text: string;
  fromAddress: string | null;
  /** YYYY-MM-DD the email arrived, for a day printed with no year. */
  receivedOn: string;
  hint: AppointmentHint;
  apiKey?: string | null;
  onSpend?: SpendSink;
  /** False, the default, for an account that has not opted in; Jev is then never called. */
  jevEnabled?: boolean;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
  /** Haiku's reading; replaced in tests. */
  haiku?: (input: AppointmentHaikuInput) => Promise<AppointmentHaikuReading>;
}): Promise<AppointmentReading> {
  // A forwarded confirmation is read as the original.
  const email = unwrapQuotedOriginal(input);
  const readHaiku = () =>
    (input.haiku ?? readAppointmentWithHaiku)({
      email,
      receivedOn: input.receivedOn,
      apiKey: input.apiKey,
      onSpend: input.onSpend,
    });
  const heuristic = (hint: AppointmentHint) =>
    heuristicAppointment({
      subject: email.subject,
      text: email.text,
      fromAddress: email.fromAddress,
      receivedOn: input.receivedOn,
      hint,
    });

  // The path every email took before Jev, and still takes when Jev is unsure.
  const haikuPath = async (): Promise<AppointmentReading> => {
    const read = await readHaiku();
    if (read?.ok) return { ok: true, value: read.value, source: 'llm' };
    if (read?.notAppointment) return { ok: false, notAppointment: true, reason: 'not_appointment' };
    const guessed = heuristic(input.hint);
    if (guessed) return { ok: true, value: guessed, source: 'heuristic' };
    return { ok: false, notAppointment: false, reason: 'no_extraction' };
  };

  const decided = await decideWithJev<typeof APPOINTMENT_QUESTION, Gated>({
    state: appointmentState(email),
    question: APPOINTMENT_QUESTION,
    enabled: input.jevEnabled ?? false,
    read: (answer) => ({ by: 'jev', event: answer.choice === 'not_appointment' ? null : answer.choice }),
    fallback: async () => ({ by: 'haiku', reading: await haikuPath() }),
    onSpend: input.onSpend,
    apiKey: input.jevApiKey,
    fetch: input.jevFetch,
  });

  if (decided.value.by === 'haiku') return decided.value.reading;

  const { event } = decided.value;
  if (!event) return { ok: false, notAppointment: true, reason: 'not_appointment' };

  const read = await readHaiku();
  const fromHaiku = read?.ok ? withEvent(read.value, event) : null;
  if (fromHaiku) return { ok: true, value: fromHaiku, source: 'llm' };
  const guessed = heuristic(event);
  if (guessed) return { ok: true, value: guessed, source: 'heuristic' };
  return { ok: false, notAppointment: false, reason: 'no_extraction' };
}

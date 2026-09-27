/**
 * What reading one booking email produces, and the reading that needs no
 * model.
 *
 * The model's answer is checked here (parseAppointmentExtraction) rather than
 * trusted, and the heuristic below is what runs when there is no API key or
 * the model's answer does not check out. Both are pure, so the saved messages
 * in fixtures/emails/appointments are read by the same code the sync runs.
 *
 * Times are wall clocks ("15:30 on 2026-10-06"), as the email prints them.
 * The store turns them into instants in the person's own zone.
 */

import { z } from 'zod';
import { parseLooseCalendarDate } from '@/lib/email/extract/email-dates';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import type { AppointmentHint } from './rules';

export const APPOINTMENT_EVENTS = ['booked', 'rescheduled', 'cancelled', 'reminder'] as const;
export type AppointmentEvent = (typeof APPOINTMENT_EVENTS)[number];

export type AppointmentExtraction = {
  event: AppointmentEvent;
  /** What it is: "Dental cleaning", "Haircut", "Dinner for 2". */
  title: string;
  /** Who it is with or where: "Smile Dental", "Lilia". */
  provider: string | null;
  /** The booking's confirmation number, when the email gives one. */
  reference: string | null;
  /** YYYY-MM-DD; null only for a cancellation that names no day. */
  date: string | null;
  /** HH:MM, 24-hour; null when the email gives only a day. */
  time: string | null;
  endTime: string | null;
  location: string | null;
  /** For a change: the day and time it was moved from. */
  previousDate: string | null;
  previousTime: string | null;
};

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

const hm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable()
  .optional();

const text = (max: number) => z.string().trim().max(max).nullable().optional();

const ModelAnswer = z.object({
  event: z.enum(APPOINTMENT_EVENTS),
  title: z.string().trim().min(1).max(200),
  provider: text(200),
  reference: text(100),
  date: ymd,
  time: hm,
  endTime: hm,
  location: text(300),
  previousDate: ymd,
  previousTime: hm,
});

/**
 * Check the model's JSON. Not ok when it said "not an appointment" or the
 * answer does not hold together; `notAppointment` tells the two apart.
 */
export function parseAppointmentExtraction(
  raw: unknown,
): { ok: true; value: AppointmentExtraction } | { ok: false; notAppointment: boolean } {
  if (raw && typeof raw === 'object' && 'error' in raw) {
    return { ok: false, notAppointment: true };
  }
  const parsed = ModelAnswer.safeParse(raw);
  if (!parsed.success) return { ok: false, notAppointment: false };
  const a = parsed.data;
  // A booking with no day cannot go on the agenda; a cancellation can still
  // find its booking by reference or by provider.
  if (!a.date && a.event !== 'cancelled') return { ok: false, notAppointment: false };
  return {
    ok: true,
    value: {
      event: a.event,
      title: a.title,
      provider: a.provider || null,
      reference: a.reference || null,
      date: a.date ?? null,
      time: a.time ?? null,
      endTime: a.endTime ?? null,
      location: a.location || null,
      previousDate: a.previousDate ?? null,
      previousTime: a.previousTime ?? null,
    },
  };
}

/**
 * The provider's name as a key: lowercased, letters and digits only, with
 * company suffixes dropped, so "Smile Dental, LLC" and "SMILE DENTAL" find
 * the same appointment.
 */
export function providerKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/\b(?:inc|llc|ltd|limited|corp|corporation|co|plc|pllc|pc|the)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 120);
  return key || name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120) || 'unknown';
}

const MONTH =
  '\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const WEEKDAY =
  '\\b(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';

/** "3:30 PM", "3pm", "15:30" as HH:MM. */
export function parseClock(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') hour += 12;
    const minute = Number(m[2] ?? '0');
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const h24 = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (h24) return `${h24[1].padStart(2, '0')}:${h24[2]}`;
  return null;
}

const CLOCK = '\\d{1,2}(?::\\d{2})?\\s*[AaPp]\\.?\\s*[Mm]\\.?';

/**
 * The first day and time the body names, as "Tuesday, October 6 at 3:30 PM"
 * or "10/06/2026 3:30 PM" do. A month and day with no year is in the year the
 * email arrived, or the next one when that would put it months behind.
 */
function findWhen(body: string, receivedOn: string): { date: string; time: string | null } | null {
  const year = Number(receivedOn.slice(0, 4));
  const patterns = [
    new RegExp(`(?:${WEEKDAY},?\\s+)?(${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)(?:[^\\n\\d]{0,12}?(${CLOCK}))?`, 'i'),
    new RegExp(`(?:${WEEKDAY},?\\s+)?(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})(?:[^\\n\\d]{0,12}?(${CLOCK}))?`, 'i'),
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (!m) continue;
    const raw = m[1].replace(/(\d)(?:st|nd|rd|th)\b/i, '$1');
    let date = parseLooseCalendarDate(raw, year);
    if (!date) continue;
    if (!/\d{4}\s*$/.test(raw) && date < shiftDays(receivedOn, -60)) {
      date = parseLooseCalendarDate(`${raw}, ${year + 1}`, year + 1) ?? date;
    }
    return { date, time: m[2] ? parseClock(m[2]) : null };
  }
  return null;
}

function shiftDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A reading from the subject and body alone, when there is no model: the day
 * and time first printed, the sender's name as the provider, and the kind the
 * subject gave. Null when the body names no day, except for a cancellation.
 */
export function heuristicAppointment(input: {
  subject: string;
  text: string;
  fromAddress: string | null;
  receivedOn: string;
  hint: AppointmentHint;
}): AppointmentExtraction | null {
  const when = findWhen(`${input.subject}\n${input.text}`, input.receivedOn);
  if (!when && input.hint !== 'cancelled') return null;

  const provider = displayNameFromAddress(input.fromAddress);
  const reference =
    input.text.match(/\b(?:confirmation|booking|reservation)\s*(?:number|no\.?|#|code)?[:\s#]+([A-Z0-9-]{4,20})\b/i)?.[1] ??
    null;
  const location = input.text.match(/^\s*(?:location|address|where)\s*[:\-]\s*(.{3,300})$/im)?.[1]?.trim() ?? null;
  const title = /\b(?:table|reservation|dinner|lunch|brunch)\b/i.test(input.subject)
    ? 'Reservation'
    : 'Appointment';

  return {
    event: input.hint,
    title,
    provider,
    reference: reference && /\d/.test(reference) ? reference : null,
    date: when?.date ?? null,
    time: when?.time ?? null,
    endTime: null,
    location,
    previousDate: null,
    previousTime: null,
  };
}

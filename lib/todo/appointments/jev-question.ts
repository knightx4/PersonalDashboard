import type { AppointmentEvent } from './extraction';

/**
 * The appointment gate as one question for Jev (plan #1167).
 *
 * Haiku's prompt in extract.ts asks whether the email is about a specific
 * appointment of the person's, and if so which of the four events it
 * reports. Jev answers both at once by picking one of the four events or
 * `not_appointment`. The meanings are the ones Haiku is given.
 *
 * Jev reads what Haiku reads: sender, subject and the first 10,000
 * characters of the body.
 */

export type AppointmentGateLabel = AppointmentEvent | 'not_appointment';

export const APPOINTMENT_OPTIONS: Readonly<Record<AppointmentGateLabel, string>> = {
  booked: 'A new booking is confirmed.',
  rescheduled: 'A booking moved to a new time.',
  cancelled: 'A booking will no longer happen.',
  reminder: 'A reminder of a booking already made.',
  not_appointment:
    'Not about a specific appointment of theirs: marketing, a newsletter, a review request, a receipt for a visit already past, a flight, a hotel stay, an order or delivery, a job interview, or a calendar invitation from a person.',
};

export const APPOINTMENT_QUESTION = {
  type: 'choice',
  question:
    'This email may be about an appointment or reservation the person has booked: a doctor, dentist or therapist, a haircut or spa, a class or session, a restaurant table, a repair or service visit. What does it report?',
  options: APPOINTMENT_OPTIONS,
} as const;

/** The same cut the Haiku call makes. */
export const APPOINTMENT_BODY_CHARS = 10_000;

export function appointmentState(email: {
  fromAddress: string | null;
  subject: string;
  text: string;
}): Record<string, string> {
  return {
    from: email.fromAddress ?? 'unknown',
    subject: email.subject,
    body: email.text.slice(0, APPOINTMENT_BODY_CHARS),
  };
}

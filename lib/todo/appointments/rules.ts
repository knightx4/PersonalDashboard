/**
 * Which mail the appointments linker claims, from the sender and subject.
 *
 * The free half of the linker: nothing here fetches a body or calls a model.
 * A claimed message has its body read by Haiku (extract.ts), which still says
 * "not an appointment" for a newsletter from a booking site, so this errs
 * towards claiming where a subject could go either way. What it must not
 * claim is another linker's mail: an order or a delivery is the commerce
 * linker's, an interview is the job linker's, and a bill or a renewal is the
 * recurring-payments linker's.
 */

import { bareAddress, domainFromAddress } from '@/lib/email/extract/classify';

export type AppointmentHint = 'booked' | 'rescheduled' | 'cancelled' | 'reminder';

export type AppointmentVerdict =
  | { claim: true; hint: AppointmentHint; reason: 'subject' | 'sender' }
  | { claim: false; reason: 'other_linker' | 'travel' | 'invite' | 'no_match' };

/**
 * Sites whose mail is about a booking: restaurants, doctors, salons, classes.
 * A sender here is claimed on any booking-shaped subject ("Confirmed: Lilia,
 * Fri"), not only one that says "appointment".
 */
export const BOOKING_SENDER_DOMAINS: readonly string[] = [
  // Tables
  'opentable.com',
  'resy.com',
  'sevenrooms.com',
  'exploretock.com',
  'tock.com',
  'yelp.com',
  // Doctors and dentists
  'zocdoc.com',
  'onemedical.com',
  'mychart.com',
  'mychartonline.com',
  'solutionreach.com',
  'weave.com',
  'lighthouse360.com',
  'nexhealth.com',
  // Salons, spas and classes
  'mindbodyonline.com',
  'mindbody.io',
  'vagaro.com',
  'booksy.com',
  'fresha.com',
  'styleseat.com',
  'schedulicity.com',
  'glossgenius.com',
  'squareup.com',
  'classpass.com',
  // Scheduling tools
  'acuityscheduling.com',
  'calendly.com',
  'setmore.com',
  'zenoti.com',
];

const CANCEL_WORDS = /\bcancel(?:l)?(?:ed|ation)\b/i;
const RESCHEDULE_WORDS = /\b(?:reschedul\w*|(?:has been |was )?(?:changed|moved|updated)\b|new time)/i;
const REMINDER_WORDS = /\b(?:remind\w*|upcoming|tomorrow|see you (?:soon|tomorrow|on|at))\b/i;

/** Subjects that are about a booking whoever sent them. */
const APPOINTMENT_SUBJECT =
  /\b(?:appointments?|appt|booking (?:confirm\w*|reminder|update|changed|cancel\w*|details|request)|your booking|you(?:'re| are) (?:all )?booked|booked:|reservations? (?:confirm\w*|reminder|update|changed|cancel\w*|at|for|details)|your (?:reservation|upcoming (?:visit|reservation|appointment)|visit (?:to|with|on|at)|table)|table for \d|(?:visit|session|class) (?:confirm\w*|reminder|cancel\w*|booked))\b/i;

/** Subjects from a booking site that are about a booking. */
const BOOKING_SITE_SUBJECT =
  /\b(?:confirm\w*|booked|booking|reservation|reserved|remind\w*|upcoming|tomorrow|today|cancel\w*|reschedul\w*|see you|table|visit|appointment)\b/i;

/** Another linker's mail: orders and deliveries, bills and renewals. */
const OTHER_LINKER_SUBJECT =
  /\b(?:order(?:ed)?|shipped|shipment|out for delivery|delivered|delivery|tracking|refund(?:ed)?|return(?:ed|s)?|bill|invoice|receipt|payment|statement|subscription|renewal|renews|membership)\b/i;

/**
 * Job mail, always the job linker's: an interview is already on the agenda
 * through the interviews source, and claiming it here would put it there twice.
 */
const JOB_SUBJECT = /\b(?:interview\w*|application|applying|recruit\w*|candidate)\b/i;

/** Travel is its own kind of booking and not a time in the day. */
const TRAVEL_SUBJECT =
  /\b(?:flight|boarding|check-?in|itinerary|trip|hotel|stay|airbnb|car rental|e-?ticket|seat assignment)\b/i;

/** Calendar invitations are already on the calendar they came from. */
const INVITE_SUBJECT = /^(?:(?:updated |new event )?invitation|accepted|declined|tentative)(?: \([^)]*\))?:/i;

function matchesDomain(domain: string | null, list: readonly string[]): boolean {
  if (!domain) return false;
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function hintFor(subject: string): AppointmentHint {
  if (CANCEL_WORDS.test(subject)) return 'cancelled';
  if (RESCHEDULE_WORDS.test(subject)) return 'rescheduled';
  if (REMINDER_WORDS.test(subject)) return 'reminder';
  return 'booked';
}

/**
 * Decide from the envelope alone. Pure, so the rules are tested against the
 * saved messages without a database or a model.
 */
export function classifyAppointment(input: {
  fromAddress: string | null;
  subject: string | null;
}): AppointmentVerdict {
  const subject = (input.subject ?? '').trim();
  if (!subject) return { claim: false, reason: 'no_match' };

  if (INVITE_SUBJECT.test(subject)) return { claim: false, reason: 'invite' };
  if (TRAVEL_SUBJECT.test(subject)) return { claim: false, reason: 'travel' };
  if (JOB_SUBJECT.test(subject)) return { claim: false, reason: 'other_linker' };

  const appointmentWord = APPOINTMENT_SUBJECT.test(subject);
  // An order, a delivery or a bill stays with its own linker unless the
  // subject names an appointment or a reservation outright ("Payment due for
  // your appointment" is rare, and the model sorts it out).
  if (OTHER_LINKER_SUBJECT.test(subject) && !/\bappointment|\breservation|\btable for\b/i.test(subject)) {
    return { claim: false, reason: 'other_linker' };
  }

  if (appointmentWord) return { claim: true, hint: hintFor(subject), reason: 'subject' };

  const domain = domainFromAddress(bareAddress(input.fromAddress) ?? input.fromAddress);
  if (matchesDomain(domain, BOOKING_SENDER_DOMAINS) && BOOKING_SITE_SUBJECT.test(subject)) {
    return { claim: true, hint: hintFor(subject), reason: 'sender' };
  }

  return { claim: false, reason: 'no_match' };
}

/**
 * Gmail subject terms for the catch-up over older mail (sync-account.ts
 * catchUpAccount) and the shared backfill query. Wider than the rules above
 * on purpose: listing is cheap and the rules decide what is claimed.
 */
export const APPOINTMENT_SUBJECT_TERMS: readonly string[] = [
  'appointment',
  'reservation',
  'booking',
  'booked',
  'rescheduled',
  '"your visit"',
  '"table for"',
];

/**
 * The Gmail search the catch-up pages through: three months back, since an
 * appointment is booked weeks ahead, not years, and one already past has no
 * place on the agenda. The booking sites are asked for by sender as well,
 * because their confirmations are often subjected with only a name and a day.
 */
export function appointmentCatchUpQuery(): string {
  const subjects = APPOINTMENT_SUBJECT_TERMS.map((t) => `subject:${t}`).join(' OR ');
  const senders = `from:(${BOOKING_SENDER_DOMAINS.join(' OR ')})`;
  return `newer_than:90d (${subjects} OR ${senders})`;
}

/**
 * Bumped whenever the rules or the query widen, so the catch-up runs again
 * over mail it has already paged through.
 */
export const APPOINTMENT_CATCH_UP_VERSION = 1;

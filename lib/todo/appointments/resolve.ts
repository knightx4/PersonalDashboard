/**
 * Which appointment an email is about, and what it changes.
 *
 * Pure, so the matching is tested without a database. The store hands it the
 * person's appointments with the same provider and writes what it decides.
 */

import { wallClockToInstant } from '@/lib/todo/time';
import type { AppointmentExtraction } from './extraction';

export type StoredAppointment = {
  id: string;
  reference: string | null;
  startsOn: string;
  startsAt: string | null;
  status: 'booked' | 'cancelled';
  /** When the email that last changed it arrived. */
  asOf: string;
};

/** The columns an email sets, in the person's zone. */
export type AppointmentFields = {
  startsOn: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type Resolution =
  | { action: 'insert'; status: 'booked' | 'cancelled'; when: AppointmentFields }
  | {
      action: 'update';
      id: string;
      status: 'booked' | 'cancelled';
      /** Null when the email does not move it: a cancellation, or no day given. */
      when: AppointmentFields | null;
    }
  /** An older email about a row a newer one already set. */
  | { action: 'stale'; id: string }
  /** A cancellation with nothing to cancel and no day to record it on. */
  | { action: 'unmatched' };

/** The instants a day and wall clock name in a zone. */
export function fieldsFor(
  date: string,
  time: string | null,
  endTime: string | null,
  timezone: string,
): AppointmentFields {
  const startsAt = time ? wallClockToInstant(date, time, timezone) : null;
  let endsAt = time && endTime ? wallClockToInstant(date, endTime, timezone) : null;
  if (startsAt && endsAt && endsAt < startsAt) endsAt = null;
  return { startsOn: date, startsAt, endsAt };
}

function sameSlot(row: StoredAppointment, when: AppointmentFields): boolean {
  if (row.startsOn !== when.startsOn) return false;
  // A day with no time on either side is the same slot; two different times
  // on one day are two appointments.
  return row.startsAt == null || when.startsAt == null || row.startsAt === when.startsAt;
}

/**
 * Decide what one reading does to the person's appointments with that
 * provider.
 *
 * Found by, in order: the confirmation number; for a change, the day and time
 * it moved from; the day and time it names; and, for a change or a
 * cancellation that gives neither, the one booking still ahead. An email older
 * than the row's last change changes nothing, because mail is read newest
 * first and the catch-up brings older mail in later.
 */
export function resolveAppointment(opts: {
  reading: AppointmentExtraction;
  candidates: readonly StoredAppointment[];
  /** ISO instant the email arrived. */
  receivedAt: string;
  timezone: string;
}): Resolution {
  const { reading, candidates, receivedAt, timezone } = opts;
  const receivedOn = new Date(receivedAt).toISOString().slice(0, 10);
  const when = reading.date ? fieldsFor(reading.date, reading.time, reading.endTime, timezone) : null;
  const previous = reading.previousDate
    ? fieldsFor(reading.previousDate, reading.previousTime, null, timezone)
    : null;

  const byReference = reading.reference
    ? candidates.find((row) => row.reference && row.reference.toLowerCase() === reading.reference!.toLowerCase())
    : undefined;
  const byPrevious = previous ? candidates.find((row) => sameSlot(row, previous)) : undefined;
  const bySlot = when ? candidates.find((row) => sameSlot(row, when)) : undefined;

  let match = byReference ?? byPrevious ?? bySlot;
  if (!match && (reading.event === 'cancelled' || reading.event === 'rescheduled')) {
    const ahead = candidates.filter((row) => row.status === 'booked' && row.startsOn >= receivedOn);
    if (ahead.length === 1) match = ahead[0];
  }

  const status = reading.event === 'cancelled' ? 'cancelled' : 'booked';

  if (match) {
    if (Date.parse(receivedAt) < Date.parse(match.asOf)) return { action: 'stale', id: match.id };
    return { action: 'update', id: match.id, status, when: status === 'cancelled' ? null : when };
  }

  // A cancellation read before its booking is kept, cancelled, so the booking
  // arriving later through the catch-up finds it and stays off the agenda.
  if (!when) return { action: 'unmatched' };
  return { action: 'insert', status, when };
}

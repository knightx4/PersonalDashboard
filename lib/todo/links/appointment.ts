import type { AppointmentRef } from '@/lib/todo/links/model';

/**
 * Finding a linked appointment's current copy (plan #1373).
 *
 * A link to a subscribed appointment cannot hold the id of its row, because a
 * refresh deletes every row a subscription contributed and writes them again.
 * It holds what the calendar file calls the appointment instead: the
 * subscription, the UID, and for a repeating meeting the date it originally
 * fell on (todo.feed_events.occurrence, which a moved date keeps). Each time a
 * page draws, the link is matched against whatever the latest copy holds on
 * those three. A match is the meeting as it stands now, moved or renamed; no
 * match means the calendar no longer has it, and the link falls back to the
 * name and date it saved.
 *
 * Pure, so the matching can be tested without a database.
 */

/** The fields of a feed_events row the match needs. */
export interface AppointmentCopy {
  feedId: string;
  uid: string;
  occurrence: string | null;
}

function key(feedId: string, uid: string, occurrence: string | null): string {
  // A NUL cannot appear in either text column, so the parts cannot run together.
  return [feedId, uid, occurrence ?? ''].join('\u0000');
}

/**
 * The saved start, written the way feed_events.occurrence is written: the day
 * for a whole-day appointment, the UTC instant for a timed one.
 */
export function savedStartAsOccurrence(ref: Pick<AppointmentRef, 'startsOn' | 'startsAt'>): string | null {
  if (ref.startsOn) return ref.startsOn;
  if (!ref.startsAt) return null;
  const instant = new Date(ref.startsAt);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * Pairs each link with its current copy, or with null when the calendar no
 * longer has it.
 *
 * One fallback, for the hour after plan #1372 shipped: a row written before
 * it carries no occurrence, so a link made from one of a repeat's dates saved
 * none either, while the refreshed copy now has one. Such a link is matched to
 * the date of that meeting whose original start is the start the link saved.
 * A link made from a true one-off finds its copy on the first try and never
 * reaches the fallback.
 */
export function matchAppointments<C extends AppointmentCopy>(
  refs: AppointmentRef[],
  copies: C[],
): Map<AppointmentRef, C | null> {
  const byKey = new Map<string, C>();
  for (const copy of copies) {
    const k = key(copy.feedId, copy.uid, copy.occurrence);
    if (!byKey.has(k)) byKey.set(k, copy);
  }

  const matched = new Map<AppointmentRef, C | null>();
  for (const ref of refs) {
    let copy = byKey.get(key(ref.feedId, ref.uid, ref.occurrence)) ?? null;
    if (!copy && ref.occurrence === null) {
      const start = savedStartAsOccurrence(ref);
      if (start) copy = byKey.get(key(ref.feedId, ref.uid, start)) ?? null;
    }
    matched.set(ref, copy);
  }
  return matched;
}

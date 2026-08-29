/**
 * A calendar invite, reduced to the interview it describes.
 *
 * Pure on purpose: the decisions here — is this a video call or an onsite, is
 * this a new booking or a revision of one we already have, who is actually in
 * the room — are the parts worth testing, and none of them need a database.
 */

import type { IcsEvent } from './ics';

export type InterviewFormat = 'phone' | 'video' | 'onsite';
export type InterviewKind =
  | 'recruiter_screen'
  | 'hiring_manager'
  | 'technical'
  | 'case'
  | 'panel'
  | 'onsite'
  | 'final'
  | 'informal';

export interface InviteInterview {
  /** Null for an invite that omits UID, which is rare and not worth trusting. */
  icsUid: string | null;
  icsSequence: number;
  /** ISO instant. Null means the invite carried no usable time. */
  scheduledAt: string | null;
  durationMinutes: number | null;
  format: InterviewFormat | null;
  meetingUrl: string | null;
  location: string | null;
  timeZone: string | null;
  cancelled: boolean;
  /** Everyone on the invite except you, organiser first. */
  interviewerNames: string[];
  /** Their addresses, in the same order, for matching against contacts. */
  interviewerEmails: string[];
  /** From the invite's own title, when it says. Null leaves the caller's guess. */
  kind: InterviewKind | null;
}

/** A location that names a room, a floor or a street rather than a product. */
const ADDRESS_HINT =
  /\d+\s+\w|\bfloor\b|\bsuite\b|\bstreet\b|\bst\.?\b|\bave\b|\bavenue\b|\broad\b|\brd\.?\b|\bblvd\b|\boffice\b|\bhq\b|\broom\b|\bbuilding\b|\bbldg\b/i;

const PHONE_HINT =
  /\bphone\b|\bcall you\b|\bdial\b|\btelephone\b|^tel:|\+\d[\d\s().-]{7,}/i;

/**
 * Video, phone or onsite, from what the invite says rather than what the prose
 * implied.
 *
 * Order matters: a conference link is decisive, because plenty of onsite-
 * looking invites also carry a dial-in, and an invite with a Meet link is a
 * video call whatever the LOCATION field says.
 */
export function formatFromInvite(event: IcsEvent): InterviewFormat | null {
  if (event.conferenceUrl) return 'video';

  const location = event.location ?? '';
  if (PHONE_HINT.test(location)) return 'phone';
  if (ADDRESS_HINT.test(location)) return 'onsite';

  // A phone screen often says so in the title and nowhere else.
  const summary = event.summary ?? '';
  if (/\bphone (screen|call|interview)\b/i.test(summary)) return 'phone';
  if (/\bonsite\b|\bon-site\b|\bin[- ]person\b/i.test(summary)) return 'onsite';

  return null;
}

/**
 * The round, when the invite's title names it.
 *
 * Only the unambiguous cases. "Interview with Dana" says nothing about which
 * round it is, and guessing would overwrite what the extractor worked out from
 * the surrounding thread.
 */
export function kindFromInvite(event: IcsEvent): InterviewKind | null {
  const text = `${event.summary ?? ''} ${event.description?.slice(0, 400) ?? ''}`;

  if (/\bfinal round\b|\bfinal interview\b/i.test(text)) return 'final';
  if (/\bonsite\b|\bon-site\b/i.test(text)) return 'onsite';
  if (/\bpanel\b/i.test(text)) return 'panel';
  if (/\bcase (study|interview)\b/i.test(text)) return 'case';
  if (/\b(technical|coding|system design|pair(ing)?) (interview|screen|round|session)\b/i.test(text))
    return 'technical';
  if (/\bhiring manager\b/i.test(text)) return 'hiring_manager';
  if (/\brecruiter (screen|call|chat)\b|\bphone screen\b|\bintro call\b/i.test(text))
    return 'recruiter_screen';

  return null;
}

function sameAddress(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/**
 * Reduce an invite to the interview it books, or null if it books nothing.
 *
 * `selfEmail` is the connected mailbox: you are on every one of these invites
 * and are not one of your own interviewers, and without it the panel list
 * reads back with your own name at the top of it.
 */
export function interviewFromInvite(
  event: IcsEvent,
  options: { selfEmail?: string | null } = {},
): InviteInterview | null {
  // An all-day block is a deadline or a hold, not an appointment. It still
  // reaches the timeline as an event; it just does not become an interview.
  if (!event.startsAt || event.allDay) return null;

  const self = options.selfEmail ?? null;

  const people = [
    ...(event.organizer ? [event.organizer] : []),
    ...event.attendees,
  ].filter((person) => !sameAddress(person.email, self));

  // Same person as organiser and attendee is the normal case, not a panel of
  // two, so dedupe on address before anything counts them.
  const seen = new Set<string>();
  const interviewers = people.filter((person) => {
    const key = (person.email ?? person.name ?? '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    icsUid: event.uid,
    icsSequence: event.sequence,
    scheduledAt: event.startsAt.toISOString(),
    durationMinutes: event.durationMinutes,
    format: formatFromInvite(event),
    meetingUrl: event.conferenceUrl,
    location: event.location,
    timeZone: event.timeZone,
    cancelled: event.cancelled,
    interviewerNames: interviewers
      .map((person) => person.name ?? person.email)
      .filter((name): name is string => Boolean(name)),
    interviewerEmails: interviewers
      .map((person) => person.email)
      .filter((email): email is string => Boolean(email)),
    kind: kindFromInvite(event),
  };
}

/**
 * Whether an arriving invite should be written over the one already stored.
 *
 * Mail arrives out of order more often than anyone expects — a backfill walks
 * a thread backwards, and a resend can land after the revision that replaced
 * it. Comparing SEQUENCE is what stops yesterday's cancelled slot from
 * un-cancelling itself.
 */
export function inviteSupersedes(
  incoming: { icsSequence: number },
  stored: { icsSequence: number | null },
): boolean {
  if (stored.icsSequence == null) return true;
  return incoming.icsSequence >= stored.icsSequence;
}

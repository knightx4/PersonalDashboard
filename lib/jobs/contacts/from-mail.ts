/**
 * The people already in the mailbox.
 *
 * Contacts and interview participants were both empty after six months and 671
 * ingested messages, because both were things you had to type in -- and every
 * feature in this app that requires typing has zero rows. Meanwhile every
 * recruiter email carries a name and an address in its From header, and every
 * calendar invite lists its attendees. The extraction already runs; it simply
 * threw the people away.
 *
 * The whole difficulty is not creating junk. A contact list with
 * "Kalshi Hiring Team" and "no-reply" in it is worse than an empty one,
 * because an empty one is honestly empty and a junk one has to be cleaned. So
 * this is deliberately strict, and prefers to miss a real person over
 * recording a mailbox.
 */

import type { MessageClassification } from '@/lib/jobs/email/classify';
import { addressOnly, displayName } from '@/lib/jobs/followup/compose';

/** Mail a human sat down and wrote. The rest is machinery. */
const HUMAN_WRITTEN: ReadonlySet<MessageClassification> = new Set([
  'recruiter_outreach',
  'recruiter_reply',
  'interview_invite',
  'scheduling',
  'offer',
]);

/**
 * Local parts that are a function rather than a person.
 *
 * Matched on the whole local part or on a dotted/hyphenated segment of it, so
 * `careers` and `talent.acquisition` both go, while `noreen` and `jobst` --
 * real names that contain `no` and `jobs` -- stay.
 */
const ROLE_MAILBOXES = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'notifications',
  'notification',
  'alerts',
  'updates',
  'mailer',
  'mail',
  'bounce',
  'bounces',
  // `hit-reply@linkedin.com` and friends: a return path, not a person.
  'reply',
  'replies',
  'careers',
  'career',
  'jobs',
  'job',
  'recruiting',
  'recruitment',
  'recruiter',
  'talent',
  'hiring',
  'hr',
  'people',
  'team',
  'hello',
  'hi',
  'info',
  'contact',
  'support',
  'help',
  'admin',
  'apply',
  'applications',
  'candidates',
  'interviews',
  'scheduling',
  'calendar',
  'invite',
  'invites',
  // Service accounts. `svc-ai-trainer@linkedin.com` is shaped like a name and
  // is a robot.
  'svc',
  'service',
  'services',
  'system',
  'mailbox',
  'postmaster',
]);

/**
 * Domains whose addresses are per-message rather than per-person.
 *
 * A LinkedIn InMail replies to `<uuid>@reply.linkedin.com`, and that uuid is
 * different in every message. Storing it would make one recruiter into as many
 * contacts as they sent messages, each with an address that stops working. The
 * person is still recorded -- just without an address.
 */
const RELAY_DOMAINS = [
  'reply.linkedin.com',
  'hit-reply.linkedin.com',
  'bounce.linkedin.com',
  'reply.indeed.com',
];

/**
 * Words that make a display name an organisation rather than a person.
 *
 * "Kalshi Hiring Team", "Greenhouse Notifications", "Ramp Recruiting" are all
 * shaped like names and are none of them a person you can write back to.
 */
const NOT_A_PERSON =
  /\b(team|hiring|recruit(ing|ment)?|talent|careers?|jobs?|notifications?|no[- ]?reply|support|hr|people ops|university|admin|desk|bot|via|scheduling|interviews?)\b/i;

export interface CandidateContact {
  fullName: string;
  email: string | null;
  relationship: 'recruiter' | 'interviewer';
}

/**
 * Whether a name is a person's, as far as a header can tell.
 *
 * Requires letters and no organisation words. A single given name is allowed:
 * plenty of recruiters sign as "Dana", and a first name is enough to greet
 * somebody by.
 */
export function looksLikeAPerson(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (trimmed.includes('@')) return false;
  if (NOT_A_PERSON.test(trimmed)) return false;
  // At least one run of letters. Rejects "-", "()" and lone initials.
  return /\p{L}{2,}/u.test(trimmed);
}

/**
 * Role words distinctive enough to catch anywhere inside a local part.
 *
 * The segment set above deliberately refuses to match on substrings, because
 * `hr` and `jobs` live inside `hrafn` and `jobst`. That leaves a mailbox that
 * runs the words together: a Greenhouse superday invites `galaxyinterviews@`
 * and `schedule@lily.greenhouse.io`, and both were recorded as people on the
 * panel. Every word here is six characters or more and does not occur inside a
 * name, so a substring match is safe for these and only these.
 */
const MACHINE_WORDS = [
  'noreply',
  'donotreply',
  'notification',
  'interview',
  // scheduling, scheduler, schedule.
  'schedul',
  // recruiting, recruitment, recruiter.
  'recruit',
  'careers',
  'talent',
  'hiring',
  'candidate',
  'applications',
  'automated',
  'postmaster',
];

/** Whether an address belongs to a person rather than a function. */
export function isPersonalAddress(address: string | null | undefined): boolean {
  const bare = addressOnly(address);
  if (!bare) return false;
  const local = bare.split('@')[0].toLowerCase();
  if (ROLE_MAILBOXES.has(local)) return false;
  if (MACHINE_WORDS.some((word) => local.includes(word))) return false;
  // `talent.acquisition@`, `no-reply+123@`, `careers-uk@`.
  return !local
    .split(/[.\-+_]/)
    .some((segment) => ROLE_MAILBOXES.has(segment));
}

/** Whether an address is a per-message relay rather than a person's. */
export function isRelayAddress(address: string | null | undefined): boolean {
  const bare = addressOnly(address)?.toLowerCase();
  if (!bare) return false;
  const domain = bare.split('@')[1] ?? '';
  return RELAY_DOMAINS.some((relay) => domain === relay || domain.endsWith(`.${relay}`));
}

/**
 * "Sam Young (via Calendly)" is Sam Young.
 *
 * Tools that send on somebody's behalf say so in the display name, and the
 * parenthetical is the tool rather than part of the person.
 */
const VIA = /\((?:via|through|on behalf of)\b[^)]*\)\s*$/i;

/** Whether a display name says a tool is sending for somebody. */
export function saysVia(name: string | null | undefined): boolean {
  return Boolean(name && VIA.test(name));
}

export function stripVia(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = name.replace(/\s*\((?:via|through|on behalf of)\b[^)]*\)\s*$/i, '').trim();
  return stripped || null;
}

/**
 * The person who sent this message, if a person sent it.
 *
 * Returns null for anything automated, for a role mailbox, and for mail whose
 * class means a system wrote it -- a rejection is a mail merge however warmly
 * it is worded, and the name on it is not somebody you know.
 *
 * The name and the address are chosen separately on purpose. A scheduling tool
 * puts the person's name in the From display name and their real address in
 * Reply-To, and taking both from one header would lose one or the other.
 */
export function contactFromSender(input: {
  classification: MessageClassification;
  fromAddress: string | null;
  replyToAddress?: string | null;
  /** The connected mailbox. You are not one of your own contacts. */
  selfAddress?: string | null;
}): CandidateContact | null {
  if (!HUMAN_WRITTEN.has(input.classification)) return null;

  const headers = [input.replyToAddress, input.fromAddress];
  const self = addressOnly(input.selfAddress)?.toLowerCase() ?? null;

  if (self && headers.some((header) => addressOnly(header)?.toLowerCase() === self)) {
    return null;
  }

  // A display name is only a person's when the address beside it belongs to a
  // person, to a relay standing in for one, or when the header says outright
  // that a tool is sending on somebody's behalf. Otherwise it is a label on a
  // mailbox: "Kalshi Hiring Team", "Workday Notifications", "svc-ai-trainer".
  const name = headers
    .filter(
      (header) =>
        isPersonalAddress(header) ||
        isRelayAddress(header) ||
        saysVia(displayName(header)),
    )
    .map((header) => stripVia(displayName(header)))
    .find((candidate) => looksLikeAPerson(candidate));
  if (!name) return null;

  // Reply-to first: a scheduling tool sends as itself and points replies at
  // the coordinator, who is the person in the conversation.
  const email = headers
    .filter((header) => isPersonalAddress(header) && !isRelayAddress(header))
    .map((header) => addressOnly(header))
    .find(Boolean);

  return {
    fullName: name.replace(/\s+/g, ' ').trim(),
    email: email ?? null,
    relationship: 'recruiter',
  };
}

/**
 * Everyone on a calendar invite except you.
 *
 * The invite parser already pairs names with addresses and drops the account's
 * own; this only decides which of them are worth a row. An attendee with an
 * address but no name is kept, because on an invite the address alone is still
 * a person you will be in a room with -- unlike in a From header, where a
 * bare address is usually a machine.
 */
export function contactsFromInvite(invite: {
  interviewerNames: readonly string[];
  interviewerEmails: readonly string[];
}): CandidateContact[] {
  const out: CandidateContact[] = [];
  const seen = new Set<string>();
  const count = Math.max(invite.interviewerNames.length, invite.interviewerEmails.length);

  for (let i = 0; i < count; i += 1) {
    const rawName = invite.interviewerNames[i] ?? null;
    const email = addressOnly(invite.interviewerEmails[i] ?? null);
    if (!isPersonalAddress(email)) continue;

    const name = looksLikeAPerson(rawName)
      ? rawName!.replace(/\s+/g, ' ').trim()
      : // No usable name: the address is the best label there is, and a row
        // called "dana@ramp.com" is still a person you can find again.
        email;
    if (!name) continue;

    const key = (email ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ fullName: name, email, relationship: 'interviewer' });
  }

  return out;
}

/**
 * The panel a body named, for when the invite's attendees are the robot.
 *
 * A Greenhouse superday sends one invite per slot whose only attendees are
 * `galaxyinterviews@` and `schedule@`, and names the people you will actually
 * sit with in the covering mail instead. Those names had nowhere to go: the
 * extraction recorded them on the timeline event and the rounds went on
 * reading back as the scheduling mailbox.
 *
 * A name with no address is enough. The contact row is what makes the round
 * say who is in the room, and the address fills itself in from the first mail
 * one of them sends, the same way any other blank does.
 */
export function contactsFromNames(
  names: readonly (string | null | undefined)[],
): CandidateContact[] {
  const out: CandidateContact[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    if (!looksLikeAPerson(raw)) continue;
    const fullName = raw!.replace(/\s+/g, ' ').trim();
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fullName, email: null, relationship: 'interviewer' });
  }

  return out;
}

/**
 * Which of the named panel a single slot's label mentions.
 *
 * A superday lists everyone once and then labels each slot with the one or two
 * who take it -- "Interview with Jiaying Wang, Joe Koyfman". Where a label
 * names somebody it decides that room; where no label names anybody, the
 * caller falls back to the whole panel, which is what a single-slot invite
 * with three interviewers on it actually means.
 */
export function namesInLabel(
  names: readonly string[],
  label: string | null | undefined,
): string[] {
  if (!label) return [];
  const haystack = label.toLowerCase();
  return names.filter((name) => {
    const needle = name.replace(/\s+/g, ' ').trim().toLowerCase();
    return needle.length > 1 && haystack.includes(needle);
  });
}

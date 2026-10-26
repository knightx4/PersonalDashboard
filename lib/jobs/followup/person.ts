/**
 * Who an application is followed up with, chosen from the contacts on file.
 *
 * Once an application goes in, one person is named to tell about it, with a
 * note drafted to them (designate.ts). The people who can move an
 * application are the recruiter and the hiring manager, so only they, or
 * someone on the team the role sits in, are chosen here: the person who
 * referred them, the recruiter who wrote about this application, a manager
 * on the role's team, a recruiter at the company, then anyone else on the
 * team. Knowing someone elsewhere at the company is not enough. When nobody
 * on file fits, Dash searches the web for the hiring manager or recruiter
 * (find-person.ts), and only if that finds nobody does it fall back to a
 * connection at the company who could point the way (pickWarm).
 *
 * Whether someone is on the team is read from the titles: a contact whose
 * title shares a word naming the work with the role's title ("Finance" in
 * "Head of Finance" and "Strategic Finance Lead"). Words every role here
 * carries, such as strategy and operations, do not count.
 *
 * Pure, so the order can be tested and read in one place.
 */
import type { Channel } from '@/lib/jobs/suggest/payload';

export type FileContact = {
  id: string;
  fullName: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  relationship: string;
  status: string;
  linkedinConnection: boolean;
};

export type FollowUpPick = { contactId: string; why: string; channel: Channel };

/** Titles of the people who run a team or a hiring process. */
const LEADER_WORDS = /\b(head|director|manager|lead|vp|vice president|chief|founder|cfo|coo|ceo|partner)\b/i;
/** Titles of the people who recruit. */
const RECRUITER_WORDS = /\b(recruit\w*|talent|people)\b/i;

/**
 * Words in a title that say nothing about which team it is: levels, joins,
 * and the words nearly every role in this search carries.
 */
const NOT_TEAM_WORDS = new Set([
  'senior', 'junior', 'staff', 'principal', 'associate', 'analyst', 'manager', 'lead', 'head', 'director',
  'chief', 'officer', 'vice', 'president', 'member', 'founding', 'founder', 'partner', 'global', 'team',
  'strategy', 'strategic', 'strategist', 'operations', 'business', 'general', 'generalist', 'and', 'the', 'for', 'with',
]);

/** The words in a title that name the work, cut to a stem so "Finance" meets "Financial". */
export function teamWords(title: string | null | undefined): Set<string> {
  const words = (title ?? '')
    .toLowerCase()
    .replace(/fp&a/g, 'finance planning')
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !NOT_TEAM_WORDS.has(word));
  return new Set(words.map((word) => word.slice(0, 5)));
}

function onTeam(contactTitle: string | null, role: Set<string>): boolean {
  for (const word of teamWords(contactTitle)) if (role.has(word)) return true;
  return false;
}

/** Lower is better. Null leaves the contact out: they are not who an application is followed up with. */
function tier(contact: FileContact, role: Set<string>, referralId: string | null, correspondent: string | null): number | null {
  if (contact.id === referralId) return 0;
  if (correspondent && contact.email?.toLowerCase() === correspondent) return 1;
  if (contact.status === 'dormant') return null;
  const title = contact.title ?? '';
  const team = onTeam(title, role);
  if (team && LEADER_WORDS.test(title)) return 2;
  if (contact.relationship === 'recruiter' || RECRUITER_WORDS.test(title)) return 3;
  if (team) return 4;
  return null;
}

function whyFor(contact: FileContact, rank: number, company: string): string {
  switch (rank) {
    case 0:
      return `${contact.fullName} referred you for this role.`;
    case 1:
      return `${contact.fullName} wrote to you about this application.`;
    case 2:
      return `${contact.fullName} leads the team this role sits in${contact.title ? ` (${contact.title})` : ''}.`;
    case 3:
      return `${contact.fullName} recruits at ${company}.`;
    default:
      return `${contact.fullName} works on the team this role sits in${contact.title ? ` (${contact.title})` : ''}.`;
  }
}

/**
 * How the note goes: email to whoever wrote by email or recruits, a LinkedIn
 * message to someone already connected, and otherwise email where there is
 * an address and a connection note where there is not.
 */
export function channelFor(contact: Pick<FileContact, 'email' | 'relationship' | 'status' | 'linkedinConnection'>, wroteByEmail = false): Channel {
  if (contact.email && (wroteByEmail || contact.relationship === 'recruiter')) return 'email';
  if (contact.linkedinConnection || contact.status === 'connected' || contact.status === 'responded' || contact.status === 'met') {
    return 'linkedin_dm';
  }
  return contact.email ? 'email' : 'linkedin_connect';
}

/** The recruiter or hiring manager on file for this application, or null. */
export function pickOnFile(input: {
  contacts: readonly FileContact[];
  company: string;
  role: string;
  referralContactId: string | null;
  /** The address that last wrote about this application (recipients.ts). */
  correspondentEmail: string | null;
}): FollowUpPick | null {
  const correspondent = input.correspondentEmail?.trim().toLowerCase() || null;
  const role = teamWords(input.role);
  let best: { contact: FileContact; rank: number } | null = null;
  for (const contact of input.contacts) {
    const rank = tier(contact, role, input.referralContactId, correspondent);
    if (rank === null) continue;
    if (!best || rank < best.rank) best = { contact, rank };
  }
  if (!best) return null;
  return {
    contactId: best.contact.id,
    why: whyFor(best.contact, best.rank, input.company),
    channel: channelFor(best.contact, best.rank === 1),
  };
}

/**
 * Someone they know at the company, off the team, for when neither the
 * contacts on file nor the web search turned up a recruiter or hiring
 * manager: they cannot move the application, but they can say who can.
 * A friend or former colleague first, then a fellow alum, a second-degree
 * connection, a LinkedIn connection.
 */
export function pickWarm(contacts: readonly FileContact[], company: string): FollowUpPick | null {
  const order = (c: FileContact) =>
    c.relationship === 'friend' || c.relationship === 'former_colleague'
      ? 0
      : c.relationship === 'alum'
        ? 1
        : c.relationship === 'second_degree'
          ? 2
          : c.linkedinConnection
            ? 3
            : null;
  const warm = contacts
    .filter((c) => c.status !== 'dormant' && order(c) !== null)
    .sort((a, b) => order(a)! - order(b)!);
  const contact = warm[0];
  if (!contact) return null;
  return {
    contactId: contact.id,
    why: `Nobody hiring for it turned up, and you know ${contact.fullName} at ${company}, who can point you to who is.`,
    channel: channelFor(contact),
  };
}

/**
 * What the note is for, as the drafter's aim (draft-outreach.ts). Before the
 * application goes in it asks the person's view of the role; after, it says
 * the application is in and why this role, and asks for nothing more than
 * that they know.
 */
export function followUpAim(input: { role: string; company: string; applied: boolean }): string {
  return input.applied
    ? `They just applied for the ${input.role} role at ${input.company} and want this person to know: say they applied and why this role in particular, in a line, with one thing from their own background that fits it. Ask for nothing more than to keep them in mind, or to point them to the right person if it is not them. No call request, and nothing that reads like a cover letter.`
    : `They are about to apply for the ${input.role} role at ${input.company}. Say so, and ask one plain question: whether this person would be open to a short word about the team first, or would point them to who is hiring for it.`;
}

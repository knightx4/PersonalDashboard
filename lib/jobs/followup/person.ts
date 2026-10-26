/**
 * Who an application is followed up with, chosen from the contacts on file.
 *
 * Once an application goes in, one person is named to tell about it, with a
 * note drafted to them (designate.ts). Someone already on file beats a
 * stranger found on the web, so this is tried first and costs nothing: the
 * person who referred them, then the recruiter who wrote about this
 * application, then someone they know at the company (a friend or former
 * colleague, then a fellow alum, then a second-degree connection), then a
 * LinkedIn connection there, then anyone else on file at it. Only when this finds
 * nobody does Dash search the web for the hiring manager (find-person.ts).
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

/** Titles of the people who decide on, or run, a hiring process. */
const HIRING_WORDS = /\b(head|director|manager|lead|vp|vice president|chief|founder|recruit\w*|talent|people)\b/i;

/** Lower is better. Null leaves the contact out. */
function tier(contact: FileContact, referralId: string | null, correspondent: string | null): number | null {
  if (contact.id === referralId) return 0;
  if (correspondent && contact.email?.toLowerCase() === correspondent) return 1;
  if (contact.status === 'dormant') return null;
  if (contact.relationship === 'friend' || contact.relationship === 'former_colleague') return 2;
  if (contact.relationship === 'alum') return 3;
  if (contact.relationship === 'second_degree') return 4;
  if (contact.linkedinConnection) return 5;
  if (contact.relationship === 'recruiter') return 6;
  return 7;
}

function whyFor(contact: FileContact, rank: number, company: string): string {
  switch (rank) {
    case 0:
      return `${contact.fullName} referred you for this role.`;
    case 1:
      return `${contact.fullName} wrote to you about this application.`;
    case 2:
      return `You know ${contact.fullName} (${contact.relationship.replace(/_/g, ' ')}) and they work at ${company}.`;
    case 3:
      return `${contact.fullName} is a fellow alum at ${company}.`;
    case 4:
      return `${contact.fullName} is a second-degree connection at ${company}.`;
    case 5:
      return `${contact.fullName} is one of your LinkedIn connections at ${company}.`;
    case 6:
      return `${contact.fullName} recruits at ${company}.`;
    default:
      return `${contact.fullName} is on your contacts at ${company}${contact.title ? ` as ${contact.title}` : ''}.`;
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

/** The best person on file to follow this application up with, or null. */
export function pickOnFile(input: {
  contacts: readonly FileContact[];
  company: string;
  referralContactId: string | null;
  /** The address that last wrote about this application (recipients.ts). */
  correspondentEmail: string | null;
}): FollowUpPick | null {
  const correspondent = input.correspondentEmail?.trim().toLowerCase() || null;
  let best: { contact: FileContact; rank: number; hiring: boolean } | null = null;
  for (const contact of input.contacts) {
    const rank = tier(contact, input.referralContactId, correspondent);
    if (rank === null) continue;
    const hiring = HIRING_WORDS.test(contact.title ?? '');
    if (!best || rank < best.rank || (rank === best.rank && hiring && !best.hiring)) {
      best = { contact, rank, hiring };
    }
  }
  if (!best) return null;
  return {
    contactId: best.contact.id,
    why: whyFor(best.contact, best.rank, input.company),
    channel: channelFor(best.contact, best.rank === 1),
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

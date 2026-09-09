/**
 * What the app already knows about a round, gathered into one bounded object.
 *
 * The interview prep note is mostly assembly: the requirement map, the people
 * in the room, what earlier rounds at this company asked, and the stories
 * worth having ready are all already in the database, and none of them are on
 * one page. This module does that half — pure, so the interesting rules (what
 * gets trimmed, what is admitted as absent) are testable without a database or
 * a network call, the same split as lib/jobs/evidence/sources.ts.
 *
 * It takes rows that have already been loaded and returns the same material
 * trimmed to something a single call can read: the bank through
 * shortlistEvidence() so it stays bounded as the bank grows, prior rounds
 * capped at the most recent few, the description cut short when extracted
 * requirements already stand in for it.
 *
 * The `missing` list is the point of the thing rather than a detail. A prep
 * note that quietly writes around an absent job description reads exactly like
 * one written from a full posting, and the reader cannot tell which they have.
 * Naming what was not there is what lets the note say so.
 */
import { interviewKindLabel } from '../interview-kinds';
import type { RequirementMatch } from '../evidence/match-payload';
import { MAX_SHORTLIST, shortlistEvidence, type ShortlistItem } from '../evidence/shortlist';
import type { Requirement } from '../jd/requirements';

/** Earlier rounds worth quoting. Older than this is a different process. */
export const MAX_PRIOR_ROUNDS = 4;

/** Across all prior rounds together, not per round. */
export const MAX_PRIOR_QUESTIONS = 30;

/** The description in full, when there is nothing extracted to stand in for it. */
export const MAX_JD_CHARS = 12_000;

/** The description as a reminder, when the requirements carry the detail. */
export const MAX_JD_EXCERPT_CHARS = 2_000;

/** One person's research on one company, and one round's write-up. */
export const MAX_RESEARCH_CHARS = 4_000;
export const MAX_NOTES_CHARS = 2_000;

/* -------------------------------------------------------------------------- */
/* What goes in: rows, as the page already loads them.                        */
/* -------------------------------------------------------------------------- */

export interface PrepContactRow {
  id: string;
  fullName: string;
  title: string | null;
  relationship: string | null;
  howWeConnect: string | null;
  notes: string | null;
  linkedinUrl: string | null;
}

export interface PrepParticipantRow {
  /** interviewer, recruiter, coordinator — whatever the enum holds. */
  role: string;
  /** Null only when the join came back short; the column itself is not null. */
  contact: PrepContactRow | null;
}

/** One conversation. An ordinary round has one; a superday has four. */
export interface PrepConversationRow {
  id: string;
  kind: string;
  scheduledAt: string | null;
  timeKnown: boolean;
  durationMinutes: number | null;
  format: string | null;
  participants: readonly PrepParticipantRow[];
}

/** The occasion the conversations belong to. Null when there is only one. */
export interface PrepRoundRow {
  label: string | null;
  roundNumber: number | null;
  notes: string | null;
}

export interface PrepRoleRow {
  title: string;
  seniority: string | null;
  location: string | null;
  workMode: string | null;
  jdText: string | null;
  requirements: readonly Requirement[] | null;
  requirementMatches: readonly RequirementMatch[] | null;
}

export interface PrepCompanyRow {
  name: string;
  industry: string | null;
  stage: string | null;
  headcountBand: string | null;
  research: string | null;
  priority: string | null;
}

/** A round already sat at this company, on this pursuit or an earlier one. */
export interface PrepPriorRoundRow {
  id: string;
  /** "Senior Analyst" — which pursuit it belonged to. */
  roleTitle: string | null;
  kind: string;
  scheduledAt: string | null;
  questionsAsked: readonly string[];
  notes: string | null;
}

export interface PrepProfileRow {
  targetTitles: readonly string[];
  timezone: string;
  writingStyleNotes: string | null;
}

export interface PrepInput {
  /** Every conversation in the round being prepped. */
  conversations: readonly PrepConversationRow[];
  round: PrepRoundRow | null;
  role: PrepRoleRow;
  company: PrepCompanyRow;
  priorRounds: readonly PrepPriorRoundRow[];
  bank: readonly ShortlistItem[];
  profile: PrepProfileRow;
}

/* -------------------------------------------------------------------------- */
/* What comes out.                                                            */
/* -------------------------------------------------------------------------- */

export interface PrepInterviewer {
  contactId: string;
  name: string;
  title: string | null;
  relationship: string | null;
  howWeConnect: string | null;
  notes: string | null;
  linkedinUrl: string | null;
  /** Which conversations of the round they sit in. */
  conversationIds: string[];
}

export interface PrepConversation {
  id: string;
  kind: string;
  kindLabel: string;
  scheduledAt: string | null;
  timeKnown: boolean;
  durationMinutes: number | null;
  format: string | null;
  interviewerNames: string[];
}

export interface PrepPriorRound {
  id: string;
  roleTitle: string | null;
  kind: string;
  kindLabel: string;
  scheduledAt: string | null;
  questionsAsked: string[];
  notes: string | null;
}

/**
 * What the app did not have. Named rather than free text so the call and the
 * page can both say it in their own words.
 */
export type PrepMissing =
  | 'jd'
  | 'requirements'
  | 'requirement_matches'
  | 'participants'
  | 'prior_rounds'
  | 'company_research'
  | 'bank';

/** In the words the note uses, addressed to the person reading it. */
export const PREP_MISSING_LABEL: Record<PrepMissing, string> = {
  jd: 'No job description is on file for this role.',
  requirements: 'No requirements have been extracted from the description.',
  requirement_matches: 'Your record has not been matched against the requirements yet.',
  participants: 'Nobody is named on this round yet, so who you are meeting is unknown.',
  prior_rounds: 'No earlier rounds at this company are on file.',
  company_research: 'Nothing has been written up about the company.',
  bank: 'Your evidence bank is empty, so there are no stories to draw on.',
};

export interface PrepContext {
  round: {
    label: string | null;
    roundNumber: number | null;
    /** The earliest conversation in the round. Null when none is scheduled. */
    startsAt: string | null;
    timeKnown: boolean;
    notes: string | null;
    conversations: PrepConversation[];
  };
  role: {
    title: string;
    seniority: string | null;
    location: string | null;
    workMode: string | null;
    jdExcerpt: string | null;
    /** True when the description was cut, so the note does not read it as whole. */
    jdTruncated: boolean;
    requirements: Requirement[];
    matches: RequirementMatch[];
  };
  company: {
    name: string;
    industry: string | null;
    stage: string | null;
    headcountBand: string | null;
    research: string | null;
    priority: string | null;
  };
  interviewers: PrepInterviewer[];
  priorRounds: PrepPriorRound[];
  bank: ShortlistItem[];
  profile: {
    targetTitles: string[];
    timezone: string;
    writingStyleNotes: string | null;
  };
  missing: PrepMissing[];
}

/* -------------------------------------------------------------------------- */

function trim(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}

/** Cut on a paragraph boundary where there is one, so a section is not halved. */
function cap(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf('\n\n');
  return {
    text: (boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd(),
    truncated: true,
  };
}

/** Oldest first, and a conversation with no time sorts after the ones with one. */
function byTimeAscending(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * The people, once each, however many conversations of the round they sit in.
 *
 * A superday's hiring manager often appears twice, and a note that introduces
 * the same person twice reads like it was assembled rather than written.
 */
function collectInterviewers(
  conversations: readonly PrepConversationRow[],
): PrepInterviewer[] {
  const byContact = new Map<string, PrepInterviewer>();

  for (const conversation of conversations) {
    for (const participant of conversation.participants) {
      const contact = participant.contact;
      if (!contact) continue;
      const existing = byContact.get(contact.id);
      if (existing) {
        if (!existing.conversationIds.includes(conversation.id)) {
          existing.conversationIds.push(conversation.id);
        }
        continue;
      }
      byContact.set(contact.id, {
        contactId: contact.id,
        name: contact.fullName,
        title: trim(contact.title),
        relationship: trim(contact.relationship),
        howWeConnect: trim(contact.howWeConnect),
        notes: trim(contact.notes),
        linkedinUrl: trim(contact.linkedinUrl),
        conversationIds: [conversation.id],
      });
    }
  }

  return [...byContact.values()];
}

/**
 * The most recent rounds at this company, newest first.
 *
 * Newest first because recency is what makes an earlier round worth reading:
 * the questions the screen asked last week say more about what this process
 * cares about than the ones a pursuit two years ago asked. The question budget
 * is spent in the same order for the same reason.
 */
function collectPriorRounds(
  rows: readonly PrepPriorRoundRow[],
  excludeIds: ReadonlySet<string>,
): PrepPriorRound[] {
  const recent = rows
    .filter((row) => !excludeIds.has(row.id))
    .sort((a, b) => byTimeAscending(b.scheduledAt, a.scheduledAt))
    .slice(0, MAX_PRIOR_ROUNDS);

  let budget = MAX_PRIOR_QUESTIONS;
  return recent.map((row) => {
    const questions = row.questionsAsked
      .map((question) => (question ?? '').trim())
      .filter((question) => question.length > 0)
      .slice(0, Math.max(budget, 0));
    budget -= questions.length;
    const notes = trim(row.notes);
    return {
      id: row.id,
      roleTitle: trim(row.roleTitle),
      kind: row.kind,
      kindLabel: interviewKindLabel(row.kind),
      scheduledAt: row.scheduledAt,
      questionsAsked: questions,
      notes: notes ? cap(notes, MAX_NOTES_CHARS).text : null,
    };
  });
}

/**
 * The stories the call gets to read.
 *
 * Two rules on top of the shortlist. Anything the requirement map already
 * cites is kept whatever it scores, because a map that says a requirement is
 * covered by an item the note cannot see produces a note that claims a
 * strength and cannot tell the story behind it. And a role with no extracted
 * requirements has nothing to shortlist against, so the strongest items stand
 * in — a recruiter screen booked off an inbound message is exactly the case
 * where there is no description and the bank is all there is.
 */
function collectBank(
  bank: readonly ShortlistItem[],
  requirements: readonly Requirement[],
  matches: readonly RequirementMatch[],
): ShortlistItem[] {
  if (bank.length === 0) return [];

  const byId = new Map(bank.map((item) => [item.id, item]));
  const chosen = new Map<string, ShortlistItem>();

  for (const match of matches) {
    const item = match.evidenceItemId ? byId.get(match.evidenceItemId) : undefined;
    if (item) chosen.set(item.id, item);
  }

  const rest =
    requirements.length > 0
      ? shortlistEvidence(requirements, bank)
      : [...bank].sort((a, b) => b.strength - a.strength);

  for (const item of rest) {
    if (chosen.size >= MAX_SHORTLIST) break;
    chosen.set(item.id, item);
  }

  return [...chosen.values()].slice(0, MAX_SHORTLIST);
}

/**
 * Everything one prep note reads from, trimmed to fit one call.
 *
 * Pure: the caller loads the rows and this decides what survives. Nothing here
 * throws on absence — a round with nobody named, a role with no description
 * and an empty bank is a real and common state, and it produces a thinner
 * context with more in `missing`, not an error.
 */
export function buildPrepContext(input: PrepInput): PrepContext {
  const conversationRows = [...input.conversations].sort((a, b) =>
    byTimeAscending(a.scheduledAt, b.scheduledAt),
  );
  const interviewers = collectInterviewers(conversationRows);
  const namesByConversation = new Map<string, string[]>();
  for (const person of interviewers) {
    for (const conversationId of person.conversationIds) {
      const names = namesByConversation.get(conversationId) ?? [];
      names.push(person.name);
      namesByConversation.set(conversationId, names);
    }
  }

  const conversations: PrepConversation[] = conversationRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    kindLabel: interviewKindLabel(row.kind),
    scheduledAt: row.scheduledAt,
    timeKnown: row.timeKnown,
    durationMinutes: row.durationMinutes,
    format: trim(row.format),
    interviewerNames: namesByConversation.get(row.id) ?? [],
  }));

  const scheduled = conversations.find((conversation) => conversation.scheduledAt !== null);
  const requirements = [...(input.role.requirements ?? [])];
  const matches = [...(input.role.requirementMatches ?? [])];

  // The description is a reminder once the requirements have been extracted
  // from it, and the whole of what the role wants when they have not.
  const jdText = trim(input.role.jdText);
  const jd = jdText
    ? cap(jdText, requirements.length > 0 ? MAX_JD_EXCERPT_CHARS : MAX_JD_CHARS)
    : null;

  const research = trim(input.company.research);
  const roundNotes = trim(input.round?.notes);
  const priorRounds = collectPriorRounds(
    input.priorRounds,
    new Set(conversationRows.map((row) => row.id)),
  );
  const bank = collectBank(input.bank, requirements, matches);

  const missing: PrepMissing[] = [];
  if (!jdText) missing.push('jd');
  if (requirements.length === 0) missing.push('requirements');
  if (matches.length === 0) missing.push('requirement_matches');
  if (interviewers.length === 0) missing.push('participants');
  if (priorRounds.length === 0) missing.push('prior_rounds');
  if (!research) missing.push('company_research');
  if (bank.length === 0) missing.push('bank');

  return {
    round: {
      label: trim(input.round?.label),
      roundNumber: input.round?.roundNumber ?? null,
      startsAt: scheduled?.scheduledAt ?? null,
      timeKnown: scheduled?.timeKnown ?? false,
      notes: roundNotes ? cap(roundNotes, MAX_NOTES_CHARS).text : null,
      conversations,
    },
    role: {
      title: input.role.title,
      seniority: trim(input.role.seniority),
      location: trim(input.role.location),
      workMode: trim(input.role.workMode),
      jdExcerpt: jd?.text ?? null,
      jdTruncated: jd?.truncated ?? false,
      requirements,
      matches,
    },
    company: {
      name: input.company.name,
      industry: trim(input.company.industry),
      stage: trim(input.company.stage),
      headcountBand: trim(input.company.headcountBand),
      research: research ? cap(research, MAX_RESEARCH_CHARS).text : null,
      priority: trim(input.company.priority),
    },
    interviewers,
    priorRounds,
    bank,
    profile: {
      targetTitles: [...input.profile.targetTitles],
      timezone: input.profile.timezone,
      writingStyleNotes: trim(input.profile.writingStyleNotes),
    },
    missing,
  };
}

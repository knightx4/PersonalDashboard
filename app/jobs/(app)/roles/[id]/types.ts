import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import type { RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import type { PrepNote } from '@/lib/jobs/interview/prep-payload';
import type { DevComment } from '@/lib/comments/load';

/** Everything the role page hands its tabs, loaded once by page.tsx. */
export interface PanelProps {
  roleId: string;
  applicationId: string;
  jdText: string;
  /** What the last automated board lookup did, or could not do. */
  jdLookupNote: string | null;
  jdUrl: string | null;
  atsJobId: string | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  compSource: string | null;
  requirements: Requirement[];
  /** The stored match, or null if this role has never been matched. */
  requirementMatches: RequirementMatch[] | null;
  requirementMatchesAt: string | null;
  /** The description or the bank has changed since the match was computed. */
  requirementMatchesStale: boolean;
  /** How many items the bank holds. Zero is why a match refuses to run. */
  bankSize: number;
  /** The cover letter for this application, private; empty when none is written. */
  coverLetter: string;
  timezone: string;
  /** The interview to scroll to and highlight, arriving from This week. */
  focusInterviewId?: string | null;
  events: Array<{
    id: string;
    kind: string;
    occurredAt: string;
    source: string;
    summary: string | null;
    needsReview: boolean;
    /** Set when this event came from an email that is still in the mailbox. */
    gmailHref: string | null;
  }>;
  interviews: Array<{
    id: string;
    kind: string;
    scheduledAt: string | null;
    /** False when only the day is settled: the hour is not to be shown. */
    timeKnown: boolean;
    /** The call's link from the invite, when it had one. */
    meetingUrl?: string | null;
    /** Where the interview opens in the calendar (note 7b1975cb). */
    calendarHref?: string | null;
    /** Computed on the server: reading the clock during render is unstable. */
    debriefDue: boolean;
    format: string | null;
    status: string;
    prepNotes: string;
    notes: string;
    /** Free-form notes written against this round, newest first. */
    customNotes: Array<{ id: string; body: string; createdAt: string }>;
    /** The round it is in. Every interview is in one. */
    groupId: string | null;
    questionsAsked: string[];
    /**
     * The generated prep note, which belongs to the round rather than to this
     * conversation: only the round's lead conversation carries one, and a
     * superday reads that one note rather than four.
     */
    prepNote: PrepNote | null;
    prepNoteAt: string | null;
    /** The facts it was written against have changed since. */
    prepNoteStale: boolean;
    /** Who is in the room, as contacts rather than as names on a string. */
    participants: Array<{
      contactId: string;
      name: string;
      title: string | null;
      role: string;
    }>;
  }>;
  /** Everyone known at this company, for naming an interviewer without retyping. */
  companyContacts: Array<{ id: string; name: string; title: string | null }>;
  answers: Array<{
    id: string;
    answer: string;
    status: string;
    questionId: string;
    questionText: string;
    questionKind: string;
    canonicalAnswer: string | null;
    timesSeen: number;
    /** What a previous draft cited, and what it could not ground. */
    evidenceItemIds: string[];
    unsupportedClaims: string[];
  }>;
  /** The comment thread on the role, oldest first: your notes and Dash's replies. */
  thread: DevComment[];
  /** The rounds of the process. Every interview is inside one of these. */
  interviewGroups: Array<{
    id: string;
    label: string | null;
    /** Which round of the process this is. Null until it is given one. */
    roundNumber: number | null;
    notes: string;
    /** The linked mail this round is about — the invite, the reschedule. */
    messageIds: string[];
  }>;
  /** Open to-dos you set for yourself, not events the inbox produced. */
  todos: Array<{
    id: string;
    body: string;
    dueAt: string;
    /** The email that asked for it, where one has been named. */
    message: { id: string; subject: string | null; gmailHref: string | null } | null;
  }>;
  messages: Array<{
    id: string;
    subject: string | null;
    fromAddress: string | null;
    receivedAt: string | null;
    classification: string;
    linkMethod: string | null;
    linkConfidence: number | null;
    /** Deep link into the connected mailbox; null once the envelope is scrubbed. */
    gmailHref: string | null;
  }>;
  companyName: string;
  /** Unlinked mail mentioning the company, offered to approve or wave off. */
  matchCandidates: Array<{
    id: string;
    subject: string | null;
    fromAddress: string | null;
    receivedAt: string | null;
    classification: string;
    gmailHref: string | null;
  }>;
  otherAttempts: Array<{
    id: string;
    attempt: number;
    status: ApplicationStatus;
    submittedAt: string | null;
    outcome: string | null;
    rejectionStage: string | null;
  }>;
}

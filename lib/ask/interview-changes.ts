import type { LearnChangeInput } from './learn-changes';

/**
 * The interview changes Dash makes straight away (plan #2044): a round added
 * to a role (#2044.1). Attaching an email to a round (#2044.2) and writing a
 * round's prep note (#2044.3) join this list; core migration 0215 already
 * lets Ask keep all three.
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/interview-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The interview write tools, by name, which is the kind each change is kept under. */
export const INTERVIEW_CHANGE_KINDS = ['add_interview_round', 'link_round_email'] as const;

export type InterviewChangeKind = (typeof INTERVIEW_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type InterviewChangeInput = LearnChangeInput;

export function isInterviewChangeKind(kind: string): kind is InterviewChangeKind {
  return (INTERVIEW_CHANGE_KINDS as readonly string[]).includes(kind);
}

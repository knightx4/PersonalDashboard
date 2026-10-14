import type { LearnChangeInput } from './learn-changes';

/**
 * The Jobs changes Dash makes straight away (plan #1894.6.1, feature
 * #1894.6), beyond add_role_note, add_job_lead and move_roles, which keep
 * cards of their own.
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/jobs-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The write tools, by name, which is the kind each change is kept under. */
/** Material's, Settings' and Find's (plan #1894.6.7, lib/dash/career-writes.ts), last in JOBS_WRITES. */
const CAREER_CHANGE_KINDS = ['add_evidence', 'add_resume_version', 'attach_resume_pdf', 'change_career_thought', 'add_discovered_company'] as const;

/** A role's interviews, interviewers and rounds (plan #1894.6.9, lib/dash/interview-edit-writes.ts), after them. */
const INTERVIEW_EDIT_CHANGE_KINDS = ['change_interview', 'change_interviewer', 'change_interview_round'] as const;

export const JOBS_CHANGE_KINDS = ['change_role', 'change_application', 'add_application_questions', 'save_answer', 'set_default_answer', 'change_company', 'merge_roles', 'change_reminder', 'change_waiting', 'change_role_email', 'review_application', 'review_events', 'review_emails', 'change_contact', 'change_touch', 'mark_suggestion_sent', 'add_role_from_email', ...CAREER_CHANGE_KINDS, ...INTERVIEW_EDIT_CHANGE_KINDS] as const;

/** The Jobs changes that touch many rows, whose Undo is Ask's (MANY_ROW_KINDS in lib/core/dash-actions.ts). */
export const JOBS_MANY_ROW_KINDS: readonly JobsChangeKind[] = ['merge_roles', 'change_role_email', 'review_application', 'review_events', 'review_emails', 'change_contact', 'change_touch', 'mark_suggestion_sent', 'add_application_questions', 'add_discovered_company', 'add_role_from_email', 'change_interviewer', 'change_interview_round'];

/** The review queue's changes (plan #1894.6.4), whose record keeps its rows as RowsUndo in lib/dash/jobs-writes.ts. */
export const JOBS_ROWS_KINDS: readonly JobsChangeKind[] = ['review_application', 'review_events', 'review_emails'];

export type JobsChangeKind = (typeof JOBS_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type JobsChangeInput = LearnChangeInput;

export function isJobsChangeKind(kind: string): kind is JobsChangeKind {
  return (JOBS_CHANGE_KINDS as readonly string[]).includes(kind);
}

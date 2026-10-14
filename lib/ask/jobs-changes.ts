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

/** Material's, Settings' and Find's (plan #1894.6.7, lib/dash/career-writes.ts), last in JOBS_WRITES. */
const CAREER_CHANGE_KINDS = ['add_evidence', 'add_resume_version', 'attach_resume_pdf', 'change_career_thought', 'add_discovered_company'] as const;

/** The write tools, by name, which is the kind each change is kept under. */
export const JOBS_CHANGE_KINDS = ['change_role', 'change_application', 'change_company', 'merge_roles', 'change_reminder', 'change_waiting', 'change_role_email', 'review_application', 'review_events', 'change_contact', 'change_touch', 'mark_suggestion_sent', ...CAREER_CHANGE_KINDS] as const;

/** The Jobs changes that touch many rows, whose Undo is Ask's (MANY_ROW_KINDS in lib/core/dash-actions.ts). */
export const JOBS_MANY_ROW_KINDS: readonly JobsChangeKind[] = ['merge_roles', 'change_role_email', 'review_application', 'review_events', 'change_contact', 'change_touch', 'mark_suggestion_sent', 'add_discovered_company'];

/** The review queue's changes (plan #1894.6.4), whose record keeps its rows as RowsUndo in lib/dash/jobs-writes.ts. */
export const JOBS_ROWS_KINDS: readonly JobsChangeKind[] = ['review_application', 'review_events'];

export type JobsChangeKind = (typeof JOBS_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type JobsChangeInput = LearnChangeInput;

export function isJobsChangeKind(kind: string): kind is JobsChangeKind {
  return (JOBS_CHANGE_KINDS as readonly string[]).includes(kind);
}

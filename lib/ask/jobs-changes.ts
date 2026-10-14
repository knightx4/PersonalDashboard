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
export const JOBS_CHANGE_KINDS = ['change_role', 'change_application'] as const;

export type JobsChangeKind = (typeof JOBS_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type JobsChangeInput = LearnChangeInput;

export function isJobsChangeKind(kind: string): kind is JobsChangeKind {
  return (JOBS_CHANGE_KINDS as readonly string[]).includes(kind);
}

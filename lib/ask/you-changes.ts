import type { LearnChangeInput } from './learn-changes';

/**
 * The You changes Dash makes straight away: a place they have lived, added
 * or changed (plan #1991.5), and a job on Work & school, added or corrected
 * (plan #1991.4.1).
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/you-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The You write tools, by name, which is the kind each change is kept under. */
export const YOU_CHANGE_KINDS = ['add_place', 'change_place', 'save_job', 'set_detail'] as const;

export type YouChangeKind = (typeof YOU_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type YouChangeInput = LearnChangeInput;

export function isYouChangeKind(kind: string): kind is YouChangeKind {
  return (YOU_CHANGE_KINDS as readonly string[]).includes(kind);
}

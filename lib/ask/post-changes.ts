import type { LearnChangeInput } from './learn-changes';

/**
 * The Dev changes Dash makes straight away: the text of an X post draft on
 * the Posts tab in Dev rewritten when asked (plan #2202.1), a new draft
 * saved there when asked for one (plan #2384.3), and a GitHub repository
 * added as a project on the Projects tab (plan #2553.5,
 * lib/dash/project-writes.ts).
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/post-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The post write tools, by name, which is the kind each change is kept under. */
export const POST_CHANGE_KINDS = ['rewrite_post', 'suggest_post', 'add_project'] as const;

export type PostChangeKind = (typeof POST_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type PostChangeInput = LearnChangeInput;

export function isPostChangeKind(kind: string): kind is PostChangeKind {
  return (POST_CHANGE_KINDS as readonly string[]).includes(kind);
}

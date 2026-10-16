import type { LearnChangeInput } from './learn-changes';

/**
 * The post changes Dash makes straight away: the text of an X post draft on
 * the Posts tab in Dev rewritten when asked (plan #2202.1).
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/post-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The post write tools, by name, which is the kind each change is kept under. */
export const POST_CHANGE_KINDS = ['rewrite_post'] as const;

export type PostChangeKind = (typeof POST_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type PostChangeInput = LearnChangeInput;

export function isPostChangeKind(kind: string): kind is PostChangeKind {
  return (POST_CHANGE_KINDS as readonly string[]).includes(kind);
}

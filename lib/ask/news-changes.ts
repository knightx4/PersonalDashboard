import type { LearnChangeInput } from './learn-changes';

/**
 * The News changes Dash makes straight away (plan #1894.9.4), and Home's stop
 * a price watch, which has no workspace of its own to hold it.
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/news-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The write tools, by name, which is the kind each change is kept under. */
export const NEWS_CHANGE_KINDS = [
  'mark_issue_unread',
  'save_story',
  'send_story_to_learn',
  'make_todo_from_story',
  'stop_watch',
] as const;

export type NewsChangeKind = (typeof NEWS_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type NewsChangeInput = LearnChangeInput;

export function isNewsChangeKind(kind: string): kind is NewsChangeKind {
  return (NEWS_CHANGE_KINDS as readonly string[]).includes(kind);
}

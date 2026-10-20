import { isLearnChangeKind, type LearnChangeInput, type LearnChangeKind } from './learn-changes';
import { isNewsChangeKind, type NewsChangeKind } from './news-changes';
import { isGoalsChangeKind, type GoalsChangeKind } from './goals-changes';
import { isShoppingChangeKind, type ShoppingChangeKind } from './shopping-changes';
import { isVaultChangeKind, type VaultChangeKind } from './vault-changes';
import { isJobsChangeKind, type JobsChangeKind } from './jobs-changes';
import { isYouChangeKind, type YouChangeKind } from './you-changes';
import { isInterviewChangeKind, type InterviewChangeKind } from './interview-changes';
import { isPostChangeKind, type PostChangeKind } from './post-changes';
import { isModelChangeKind, type ModelChangeKind } from './model-changes';

/**
 * The Todo changes Dash makes straight away (plan #1894.9.1), beyond add,
 * rename or move, and tick off, which keep cards of their own.
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/todo-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The Todo write tools, by name, which is the kind each change is kept under. */
export const TODO_CHANGE_KINDS = ['edit_todo', 'add_todo_item', 'link_todo', 'add_event', 'change_event', 'change_agenda_row'] as const;

export type TodoChangeKind = (typeof TODO_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type TodoChangeInput = LearnChangeInput;

export function isTodoChangeKind(kind: string): kind is TodoChangeKind {
  return (TODO_CHANGE_KINDS as readonly string[]).includes(kind);
}

/** The kinds whose card reads back the sentence its tool wrote: Learn's, Todo's and You's. */
export type WrittenCardKind = LearnChangeKind | TodoChangeKind | YouChangeKind | NewsChangeKind | GoalsChangeKind | ShoppingChangeKind | VaultChangeKind | JobsChangeKind | InterviewChangeKind | PostChangeKind | ModelChangeKind;

/** Whether a kept change is one whose card reads back what its tool wrote. */
export function isWrittenCard<C extends { kind: string; input: unknown }>(
  change: C,
): change is Extract<C, { kind: WrittenCardKind }> {
  return isTodoChangeKind(change.kind) || isLearnChangeKind(change.kind) || isYouChangeKind(change.kind) || isNewsChangeKind(change.kind) || isGoalsChangeKind(change.kind) || isShoppingChangeKind(change.kind) || isVaultChangeKind(change.kind) || isJobsChangeKind(change.kind) || isInterviewChangeKind(change.kind) || isPostChangeKind(change.kind) || isModelChangeKind(change.kind);
}

import type { LearnChangeInput } from './learn-changes';

/**
 * The Goals changes Dash makes straight away beyond add_goal, add_goal_step,
 * close_goal_step and set_goal_done_when (plan #1894.7.1): an area added,
 * renamed, reordered, archived or given a note, and a goal reworded, given a
 * date or an area, reordered, archived, closed, parked or reopened.
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/goals-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The write tools, by name, which is the kind each change is kept under. */
export const GOALS_CHANGE_KINDS = ['change_goal_area', 'change_goal'] as const;

export type GoalsChangeKind = (typeof GOALS_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type GoalsChangeInput = LearnChangeInput;

export function isGoalsChangeKind(kind: string): kind is GoalsChangeKind {
  return (GOALS_CHANGE_KINDS as readonly string[]).includes(kind);
}

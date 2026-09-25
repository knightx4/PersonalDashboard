/**
 * Something a goals run flagged on a goal (plan #1015).
 *
 * A run sometimes finds a thing the person should know that is neither a step
 * nor a question with options: the servicer moved the due date, a statement
 * shows a missed payment. It writes a row in public.raised_items with the goal
 * it is about and module 'goals' (goals migration 0031). The Goals home lists
 * an open one under Waiting on you, and the goal's page shows it with a box to
 * answer it. Answering starts a goal run with the answer in its brief, the way
 * lib/raised/pickup.ts starts the plan routine for a raise on the dev plan.
 *
 * Pure: flags-store.ts reads and writes the rows.
 */
import { threadText } from '@/lib/comments/context';
import type { DevComment } from '@/lib/comments/load';
import type { WaitingItem } from '@/lib/goals/daily';

/**
 * Open is waiting on you. Answered is waiting on the run your answer started,
 * which closes it. Closed and dismissed rows are not read.
 */
export type FlagStatus = 'open' | 'answered';

export type GoalFlag = {
  id: string;
  goalId: string;
  title: string;
  detail: string | null;
  /** What the run wants from you, when it wants something particular. */
  ask: string | null;
  status: FlagStatus;
  createdAt: string;
  /** Your answers and the run's replies, oldest first. */
  thread: DevComment[];
};

/**
 * The open flags as rows for Waiting on you, for the goals the home can name.
 * A flag on a goal that is gone or archived is left off rather than shown
 * under a goal nobody can open.
 */
export function flagsWaiting(
  flags: readonly GoalFlag[],
  goalTitles: ReadonlyMap<string, string>,
): Extract<WaitingItem, { kind: 'flag' }>[] {
  return flags
    .filter((flag) => flag.status === 'open' && goalTitles.has(flag.goalId))
    .map((flag) => ({
      kind: 'flag' as const,
      id: flag.id,
      title: flag.title,
      goalId: flag.goalId,
      goalTitle: goalTitles.get(flag.goalId)!,
    }));
}

/**
 * The brief for the run an answer starts. It names the goal and the run row
 * the way every goal run's brief does (`runText`, from goalRunText), then the
 * flag, what has been said on it, the answer, and the two writes the run
 * finishes with: its reply in the thread, and the flag closed with what came
 * of it.
 */
export function flagRunText(input: {
  /** goalRunText for the goal and the run row. */
  runText: string;
  userId: string;
  flag: Pick<GoalFlag, 'id' | 'title' | 'detail' | 'ask' | 'createdAt'>;
  /** The thread with the comment carrying the answer taken out. */
  history: readonly DevComment[];
  answer: string;
}): string {
  const { flag, userId } = input;
  const said = threadText(input.history);
  return [
    input.runText,
    '',
    'This run is for one thing: the person answered something a goals run flagged on this',
    'goal. Follow .claude/skills/goals/SKILL.md, "Flagging something on a goal", and do what',
    'the answer says within "What you may change". Do not map the goal again or work other',
    'steps.',
    '',
    `## What was flagged (raised_items id ${flag.id}, ${flag.createdAt.slice(0, 10)})`,
    '',
    flag.title,
    ...(flag.detail ? ['', flag.detail] : []),
    ...(flag.ask ? ['', `Asked: ${flag.ask}`] : []),
    '',
    ...(said ? [said.trimEnd(), ''] : []),
    '## Their answer',
    '',
    input.answer,
    '',
    '## Where your reply goes',
    '',
    'insert into public.dev_comments (user_id, raised_item_id, author, body) values ' +
      `('${userId}', '${flag.id}', 'claude', '<what you did>');`,
    '',
    '## Closing the flag, once nothing is left in it',
    '',
    "update public.raised_items set status = 'closed', outcome = '<what came of it>' " +
      `where id = '${flag.id}' and user_id = '${userId}';`,
  ].join('\n');
}

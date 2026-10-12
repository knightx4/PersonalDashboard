import { healthOf, type HealthFacts } from '@/lib/plan/health-words';
import type { PlanHealth } from '@/lib/plan/tree';
import { YOURS_ASK, YOURS_WORD, waitLine, type GoalRowNode } from './plan-rows';
import type { GoalStatus } from './tree';

/**
 * Goal and step rows drawn before the server answers (plan #1851).
 *
 * The status menu on a step row and Reopen on a goal row change the row the
 * moment they are pressed. These are the pure halves: what the change does to
 * the row. The hook that holds them, and puts the row back when the write is
 * refused, is `useOptimisticWrite`; reordering uses `swapSibling` from
 * lib/plan/optimistic.ts, which is not particular to the plan.
 */

/** The statuses a step row's menu sets directly. Blocked asks what it needs first. */
export type StepStatusChange = 'not_started' | 'done' | 'dropped';

/**
 * The row with its status changed, by the reading `goalRows` gives a step
 * with nothing else changed.
 *
 * Done and dropped are the plan's own words. A step opened again reads as
 * waiting when something it waits on is still open, as Your move when it is
 * a step of yours with nothing beneath it, and as ready otherwise. Anything
 * this cannot know from the row alone, such as a step above it closing too,
 * arrives with the revalidation a moment later.
 */
export function withStepStatus(node: GoalRowNode, status: StepStatusChange): GoalRowNode {
  const closed = status !== 'not_started';
  const facts: HealthFacts = {
    closed,
    openBeneath: [],
    resolution: node.resolution,
    blockAsk: null,
    comment: null,
    waitingOn: node.waitingOn,
  };
  const step = { ...node.step, status: closed ? status : ('open' as const), blockAsk: null };

  if (closed) {
    return {
      ...node,
      status,
      blockAsk: null,
      need: null,
      step,
      health: healthOf(status, facts),
    };
  }

  const waits = node.waitingOn.length > 0;
  const yours =
    !waits &&
    (node.step.kind === 'mine' || node.step.kind === 'rhythm') &&
    node.step.children.length === 0;
  const health: PlanHealth = waits ? 'waiting' : yours ? 'blocked' : 'ready';
  const words = healthOf(health, { ...facts, blockAsk: yours ? YOURS_ASK : null });
  return {
    ...node,
    status: 'not_started',
    blockAsk: null,
    need: yours ? YOURS_ASK : waitLine(node.waitingOn, () => false),
    step,
    health: yours ? { ...words, word: YOURS_WORD, title: YOURS_ASK } : words,
  };
}

/** What Reopen or Take it back up does to a goal row on All goals. */
export function reopenedGoal<T extends { status: GoalStatus }>(
  goal: T,
): Omit<T, 'status'> & { status: 'open' } {
  return { ...goal, status: 'open' };
}

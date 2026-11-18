import { toGoalActivity } from '@/lib/goals/tree';

/**
 * Which goals.items rows a text outside the Goals page may bring up (plan
 * #3069). A mentor's morning plan is written from the rows a reach-out watch
 * on goals.items lists (lib/you/reach-out-due.ts), and that list read every
 * row the person had changed, so the steps of a passive goal reached the
 * plan though Do next and Todo already leave them out
 * (withoutPassiveGoals in lib/goals/inbox.ts, todoSteps in lib/goals/todo.ts).
 *
 * The rule is theirs, read off the parent chain the rows already carry:
 *
 *   - A row under a passive goal, at any depth, is left out. So is a passive
 *     goal itself. Passive is `toGoalActivity`, the one reading of the
 *     column every other surface uses.
 *   - A row under a goal that is not open (proposed, parked, done or
 *     dropped) or is archived is left out, as the home and the runs leave
 *     those goals out.
 *   - A set-aside row, one whose start date or a start date above it is
 *     still ahead, stays out until its day.
 *   - A step that also counts towards another goal (goals.item_goals) still
 *     comes up when that goal is open, active and live: it is that goal's
 *     step too.
 *
 * Pure, so the tests write the tree by hand.
 */

export type ChainItem = {
  id: string;
  parentId: string | null;
  level: string;
  status: string;
  activity: unknown;
  archivedAt: string | null;
  /** YYYY-MM-DD, or null. */
  startsOn: string | null;
};

/** A live goals.item_goals row: the step also counts towards the goal. */
export type CountsTowards = { itemId: string; goalId: string };

/** How far up a chain is walked before it is taken as broken. */
const MAX_DEPTH = 24;

type Verdict = 'in' | 'aside' | 'out';

/** Walk from `id` up: 'aside' when a start date is ahead, 'out' when a goal on the way keeps it from view. */
function chainVerdict(byId: ReadonlyMap<string, ChainItem>, id: string, today: string): Verdict {
  let node = byId.get(id);
  for (let depth = 0; node && depth < MAX_DEPTH; depth += 1) {
    if (node.startsOn && node.startsOn > today) return 'aside';
    if (node.level === 'goal') {
      if (toGoalActivity(node.activity) === 'passive') return 'out';
      // The row itself may be a goal just closed, which is news; a goal above it is not.
      if (node.id !== id && (node.status !== 'open' || node.archivedAt)) return 'out';
    } else if (node.id !== id && node.archivedAt) {
      return 'out';
    }
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return 'in';
}

/** Whether a goal a step counts towards is one the step may come up by. */
function goalInView(byId: ReadonlyMap<string, ChainItem>, goalId: string, today: string): boolean {
  const goal = byId.get(goalId);
  if (!goal || goal.level !== 'goal' || goal.status !== 'open' || goal.archivedAt) return false;
  return chainVerdict(byId, goalId, today) === 'in';
}

/**
 * The ids among `ids` a text may name, in the order given. An id the tree
 * does not hold is kept: the tree is read to leave rows out, never to let
 * them in.
 */
export function goalRowsInView(input: {
  ids: readonly string[];
  items: readonly ChainItem[];
  countsTowards?: readonly CountsTowards[];
  /** The person's day, YYYY-MM-DD. */
  today: string;
}): string[] {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const linked = new Map<string, string[]>();
  for (const link of input.countsTowards ?? []) {
    linked.set(link.itemId, [...(linked.get(link.itemId) ?? []), link.goalId]);
  }
  return input.ids.filter((id) => {
    if (!byId.has(id)) return true;
    const verdict = chainVerdict(byId, id, input.today);
    if (verdict === 'in') return true;
    if (verdict === 'aside') return false;
    return (linked.get(id) ?? []).some((goalId) => goalInView(byId, goalId, input.today));
  });
}

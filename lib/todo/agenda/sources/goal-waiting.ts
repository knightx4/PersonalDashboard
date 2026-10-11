import 'server-only';

import { dailyView } from '@/lib/goals/daily';
import { stepHealth } from '@/lib/goals/status';
import type { StepNode } from '@/lib/goals/steps';
import { loadLiveTree } from '@/lib/goals/steps-store';
import type { Goal } from '@/lib/goals/tree';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS, todayIn } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';
import { stepHref } from '@/lib/goals/all-goals';

/**
 * What your goals are waiting on you for that the goal steps source does not
 * already show (plan #1473): goals Dash proposed for an area, steps Dash
 * proposed under a goal you approved, and steps blocked on something only you
 * can give them. Read from goals.items by the Goals home's own rules
 * (`dailyView` in lib/goals/daily.ts and `stepHealth` in lib/goals/status.ts),
 * so an item leaves here when its goal page stops saying the move is yours.
 *
 * Left to other places on purpose: a goal's next step and Dash's questions
 * are the goal steps source's, a result to read is the count line Todo
 * already shows (lib/todo/agenda/dash-results.ts), and a flag a goals run
 * raised is a raise, which the raised source lists.
 *
 * Always on, and not completable: approving and unblocking happen on the
 * goal. "Later" and "Not this one" go in the dismissal overlay under the goal
 * step source's value. A proposal's key carries how many were proposed, so
 * putting one off still shows the next batch.
 */

const PREFIX = 'goal_waiting:';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : `${count} ${many}`;
}

/** Every step in a tree, at any depth, in reading order. */
function walk(nodes: readonly StepNode[]): StepNode[] {
  return nodes.flatMap((node) => [node, ...walk(node.children)]);
}

/** Pure: the agenda items for what the goals are waiting on you for. Exported for tests. */
export function goalWaitingItems(
  goals: { goal: Goal; areaName: string }[],
  byGoal: Map<string, StepNode[]>,
  today: string,
): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const row of dailyView(goals, byGoal, today).waiting) {
    if (row.kind === 'plan') {
      const one = row.count === 1;
      items.push({
        key: `${PREFIX}plan:${row.id}:${row.count}`,
        source: 'goal_waiting',
        ref: `goals.items:${row.goalId}`,
        title: one
          ? `Approve the goal Dash proposed: ${row.goalTitle}`
          : `Approve the ${row.count} goals Dash proposed for ${row.title}`,
        day: null,
        at: null,
        link: one ? { href: `/goals/${row.goalId}`, label: row.goalTitle } : { href: '/goals', label: 'Goals' },
        action: null,
        detail: one ? `Proposed for ${row.title}` : null,
        completable: false,
      });
    } else if (row.kind === 'breakdown') {
      items.push({
        key: `${PREFIX}breakdown:${row.goalId}:${row.count}`,
        source: 'goal_waiting',
        ref: `goals.items:${row.goalId}`,
        title: `Approve ${plural(row.count, 'the step', 'steps')} Dash proposed for ${row.goalTitle}`,
        day: null,
        at: null,
        link: { href: `/goals/${row.goalId}`, label: row.goalTitle },
        action: null,
        detail: null,
        completable: false,
      });
    }
  }

  for (const { goal } of goals) {
    if (goal.status !== 'open') continue;
    for (const step of walk(byGoal.get(goal.id) ?? [])) {
      if (stepHealth(step) !== 'blocked') continue;
      items.push({
        key: `${PREFIX}blocked:${step.id}`,
        source: 'goal_waiting',
        ref: `goals.items:${step.id}`,
        title: step.title,
        day: null,
        onYouSince: step.createdAt ?? null,
        at: null,
        link: { href: stepHref(goal.id, step.id), label: goal.title },
        action: null,
        detail: step.blockAsk?.trim() ? `Needs: ${step.blockAsk.trim()}` : 'Blocked on you',
        completable: false,
      });
    }
  }

  return items;
}

export const goalWaitingSource: AgendaSource = {
  id: 'goal_waiting',
  label: 'Goals waiting on you',
  module: 'goals',
  alwaysOn: true,
  description: 'Goals and steps Dash proposed for you to approve, and goal steps blocked on you.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const today = todayIn(ctx.timezone, ctx.now);
    const client = await (ctx.clients ?? sessionClients).goals();
    const { goals, byGoal } = await loadLiveTree(client, { userId: ctx.userId, today });
    return goalWaitingItems(goals, byGoal, today);
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'goal_step', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'goal_step', key, null);
  },
};

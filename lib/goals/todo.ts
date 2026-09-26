/**
 * Which goal steps are on Todo (docs/GOALS-SPEC.md, "Todo"; plan #927).
 *
 * A step is on Todo while you have pressed Show on Todo on it and it is still
 * something to do: yours, open, and reachable through open steps from an open
 * goal. A step under a dropped branch or a goal you have not taken on yet
 * leaves Todo with it, the same way the Goals home leaves it out, and comes
 * back if that branch is reopened. A step whose start date has not come is
 * still listed, with that date, so Todo can hold it until the day. The flag itself is never cleared by this,
 * so reopening the step puts it back where you asked for it.
 *
 * Pure, so the rule is tested without a database. The reads are in
 * lib/goals/steps-store.ts and the agenda source that shows the result is
 * lib/todo/agenda/sources/goal-steps.ts.
 */
import type { Step, StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

export type TodoStep = {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null for an undated step. */
  dueOn: string | null;
  /** The day it can start, when that is still ahead (StepNode.waitsUntil); null once it can. */
  startsOn: string | null;
  goalId: string;
  goalTitle: string;
};

/** Whether Show on Todo means anything for this step. */
export function canShowOnTodo(step: Pick<Step, 'kind' | 'status'>): boolean {
  return step.kind === 'mine' && step.status === 'open';
}

export function todoSteps(goals: Goal[], byGoal: Map<string, StepNode[]>): TodoStep[] {
  const out: TodoStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (node.onTodo && canShowOnTodo(node)) {
          out.push({
            id: node.id,
            title: node.title,
            dueOn: node.dueOn,
            startsOn: node.waitsUntil ?? null,
            goalId: goal.id,
            goalTitle: goal.title,
          });
        }
        walk(node.children);
      }
    };
    walk(byGoal.get(goal.id) ?? []);
  }
  return out;
}

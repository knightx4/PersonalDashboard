import { STEP_GROUPS, stepGroupOf, type StepGroupId } from '@/lib/plan/feature-page';
import type { PlanHealth } from '@/lib/plan/tree';
import type { GoalRowNode } from '@/lib/goals/plan-rows';

/**
 * A goal's steps in status groups, for the Steps tab's By status view: the
 * same groups, in the same order, as a feature's Steps tab on /dev/plan
 * (lib/plan/feature-page.ts). Blocked, In progress, Ready and Not started
 * open; Done and Dropped folded.
 *
 * Every step and sub-step is listed once, by the health word its row shows.
 * A question under a step stays in that step's panel, as in the tree; one at
 * the top of the goal is a row of its own. A listed row keeps its questions
 * and loses its sub-steps, which are listed in their own groups.
 */
export const GOAL_STEPS_VIEWS = ['status', 'tree'] as const;
export type GoalStepsView = (typeof GOAL_STEPS_VIEWS)[number];

/** The view a `?view=` value opens: the tree when it says so, otherwise the groups. */
export function goalStepsViewFrom(value: string | string[] | null | undefined): GoalStepsView {
  return value === 'tree' ? 'tree' : 'status';
}

/** The address of a goal's Steps tab in a given view. */
export function goalStepsViewHref(goalId: string, view: GoalStepsView): string {
  const base = `/goals/${goalId}?tab=steps`;
  return view === 'tree' ? `${base}&view=tree` : base;
}

export type GoalGroupedStep = {
  /** The row as listed: its questions kept, its sub-steps taken off. */
  row: GoalRowNode;
  /** The step it sits under, when it is a sub-step. */
  parent: { outline: string; title: string } | null;
  /** Its place among its siblings, for Move up and Move down. */
  index: number;
  count: number;
};

export type GoalStepGroup = {
  id: StepGroupId;
  label: string;
  folded: boolean;
  steps: GoalGroupedStep[];
};

export function goalStepGroups(rows: readonly GoalRowNode[]): GoalStepGroup[] {
  const found: GoalGroupedStep[] = [];
  const walk = (nodes: readonly GoalRowNode[], parent: GoalRowNode | null) => {
    const siblings = nodes.filter((node) => node.kind !== 'decision');
    for (const node of nodes) {
      if (node.kind === 'decision' && parent) continue;
      found.push({
        row: { ...node, children: node.children.filter((child) => child.kind === 'decision') },
        parent: parent && { outline: parent.outline, title: parent.title },
        index: Math.max(0, siblings.indexOf(node)),
        count: siblings.length,
      });
      walk(node.children, node);
    }
  };
  walk(rows, null);
  return STEP_GROUPS.map((group) => ({
    ...group,
    steps: found.filter(({ row }) => stepGroupOf(row.health.name as PlanHealth) === group.id),
  })).filter((group) => group.steps.length > 0);
}

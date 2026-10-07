import type { PlanNode } from './tree';

/**
 * Who holds the open steps beneath a feature (plan #1668). The feature page
 * shows it in its properties and a press on either count filters the Steps
 * tab; the goal page reuses it, so the counting is here and not in a
 * component.
 */

/** Who holds a step: you, or Dash. */
export type HeldBy = 'me' | 'dash';

/** The query parameter the Steps tab reads the filter from. */
export const HELD_PARAM = 'held';

/** The filter a `?held=` value names, or null for every step. */
export function heldFrom(value: string | null | undefined): HeldBy | null {
  return value === 'me' || value === 'dash' ? value : null;
}

/**
 * Whose a step is. A question to answer or a setup job is always yours, since
 * only you can do it. Anything else is yours when marked so and Dash's
 * otherwise, an unassigned step included.
 */
export function heldBy(node: Pick<PlanNode, 'kind' | 'assignee'>): HeldBy {
  if (node.kind === 'decision' || node.kind === 'setup') return 'me';
  return node.assignee === 'me' ? 'me' : 'dash';
}

/**
 * What a root's progress is counted over: every step and substep beneath it
 * that is not dropped, with the questions and setup jobs among them. A
 * question asked on the root itself is not a step and is left out, as the
 * Steps tab does not list it.
 */
export function scopeSteps(root: Pick<PlanNode, 'children'>): PlanNode[] {
  const found: PlanNode[] = [];
  const walk = (nodes: readonly PlanNode[], top: boolean) => {
    for (const node of nodes) {
      if (top && node.kind === 'decision') continue;
      if (node.status === 'dropped') continue;
      found.push(node);
      walk(node.children, false);
    }
  };
  walk(root.children, true);
  return found;
}

export type ProgressSplit = {
  /** Steps in scope. */
  scope: number;
  done: number;
  /** Open steps, and how they divide between you and Dash. */
  open: number;
  me: number;
  dash: number;
};

export function progressSplit(root: Pick<PlanNode, 'children'>): ProgressSplit {
  const steps = scopeSteps(root);
  const open = steps.filter((step) => step.status !== 'done');
  const me = open.filter((step) => heldBy(step) === 'me').length;
  return {
    scope: steps.length,
    done: steps.length - open.length,
    open: open.length,
    me,
    dash: open.length - me,
  };
}

const isOpenQuestion = (node: PlanNode) =>
  node.kind === 'decision' && node.status !== 'done' && node.status !== 'dropped';

/**
 * The steps that carry the open work one side holds, for the Steps tab. A
 * question is not a row of its own there, so one you hold is listed through
 * the step it was asked on, once however many that step has.
 */
export function stepsHeldBy(root: Pick<PlanNode, 'children'>, who: HeldBy): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (nodes: readonly PlanNode[]) => {
    for (const node of nodes) {
      if (node.status === 'dropped' || node.kind === 'decision') continue;
      const own = node.status !== 'done' && heldBy(node) === who;
      const asked = who === 'me' && node.children.some(isOpenQuestion);
      if (own || asked) out.push(node);
      walk(node.children);
    }
  };
  walk(root.children);
  return out;
}

/** The address of the Steps tab showing one side's open steps. */
export function heldHref(base: string, who: HeldBy): string {
  return `${base}?tab=steps&${HELD_PARAM}=${who}`;
}

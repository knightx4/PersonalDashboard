/**
 * The path at the top of each Goals page (plan #1622): Goals, then the area,
 * the goal and the steps above the page, ending on the page itself. Each part
 * is a link, drawn by components/shell/breadcrumb.tsx.
 *
 * A step's path is found by walking its parent ids up to the goal, so a
 * sub-step at any depth names every step it sits under.
 *
 * Pure, so the paths are tested without a page.
 */
import type { Crumb } from '@/components/shell/breadcrumb';
import { areaHref, stepHref } from '@/lib/goals/all-goals';

/** The Goals home, where every path starts. */
export const GOALS_CRUMB: Crumb = { label: 'Goals', href: '/goals' };

/** All goals: Goals › All goals. */
export function allGoalsCrumbs(): Crumb[] {
  return [GOALS_CRUMB, { label: 'All goals', href: '/goals/all' }];
}

/** An area's own page: Goals › Money. */
export function areaCrumbs(area: { id: string; name: string }): Crumb[] {
  return [GOALS_CRUMB, { label: area.name, href: areaHref(area.id) }];
}

/**
 * A goal's page: Goals › Money › Pay off the cards. `open` says whether the
 * goal is still open, so the area link opens on a view that lists it.
 */
export function goalCrumbs(
  goal: { id: string; title: string; areaId: string },
  areaName: string,
  { open = true }: { open?: boolean } = {},
): Crumb[] {
  return [
    GOALS_CRUMB,
    { label: areaName, href: areaHref(goal.areaId, { open }) },
    { label: goal.title, href: `/goals/${goal.id}` },
  ];
}

type StepLike = { id: string; parentId: string; title: string; children: readonly StepLike[] };

/**
 * A step's page: the goal's path, then each step above this one, then the
 * step. Null when the step is not among the goal's own.
 */
export function stepCrumbs(
  goal: { id: string; title: string; areaId: string },
  areaName: string,
  steps: readonly StepLike[],
  stepId: string,
  { open = true }: { open?: boolean } = {},
): Crumb[] | null {
  const byId = new Map<string, StepLike>();
  const index = (nodes: readonly StepLike[]) => {
    for (const node of nodes) {
      byId.set(node.id, node);
      index(node.children);
    }
  };
  index(steps);

  const chain: StepLike[] = [];
  let at = byId.get(stepId);
  if (!at) return null;
  // Up through parent ids until the goal; the seen set stops a loop in bad data.
  const seen = new Set<string>();
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    chain.unshift(at);
    at = at.parentId === goal.id ? undefined : byId.get(at.parentId);
  }
  return [
    ...goalCrumbs(goal, areaName, { open }),
    ...chain.map((step) => ({ label: step.title, href: stepHref(goal.id, step.id) })),
  ];
}

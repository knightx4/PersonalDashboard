import type { Crumb } from '@/components/shell/breadcrumb';
import { planRowId } from '@/lib/comments/refs';
import { isProjectId, type PlanScope } from '@/lib/plan/projects';
import {
  flatten,
  healthOf,
  type PlanHealth,
  type PlanLiveness,
  type PlanNode,
  type PlanSection,
} from '@/lib/plan/tree';
import type { Tab } from '@/lib/tabs';

/**
 * A feature's own page, /dev/plan/<number> (plan #1664): where it is, which
 * feature a number belongs to, and the tabs it has.
 *
 * Pure, so the page, the plan row's title link and the tests read the same
 * answers. The page is drawn by app/dev/plan/[number]/ and feature-page.tsx.
 */

/** The address of a feature's page. */
export function featureHref(number: number): string {
  return `/dev/plan/${number}`;
}

/** The anchor of a module's section on /dev/plan, which its crumb lands on. */
export function moduleAnchor(module: PlanScope | null): string {
  return `plan-module-${module ?? 'app'}`;
}

/**
 * The tabs, in order. Overview is the plain address. Activity (plan #1667)
 * is the feature's history, newest first.
 */
export const FEATURE_TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'steps', label: 'Steps' },
];

/**
 * The feature a number belongs to, and the row it names.
 *
 * A feature is a row at the top of its module. A step's or substep's number
 * finds the feature above it, so `/dev/plan/1664` and `/dev/plan/1660` open
 * the same page, the first scrolled to that step. Null when no row has the
 * number.
 */
export function findFeature(
  sections: readonly PlanSection[],
  number: number,
): { feature: PlanNode; target: PlanNode; module: PlanScope | null; moduleLabel: string } | null {
  for (const section of sections) {
    for (const top of section.nodes) {
      const target = flatten([top]).find((node) => node.number === number);
      if (target) {
        return { feature: top, target, module: section.module, moduleLabel: section.label };
      }
    }
  }
  return null;
}

/**
 * Where a number that names a step sends you: its feature's Steps tab,
 * scrolled to the step's row. Null when the number is the feature's own.
 */
export function stepRedirect(feature: PlanNode, target: PlanNode): string | null {
  if (feature.id === target.id) return null;
  return `${featureHref(feature.number)}?tab=steps#${planRowId(target.number)}`;
}

/**
 * Dev, Plan, the module, then the feature. A project such as the website has
 * a page of its own in Dev, so its crumb goes there; a module's goes to its
 * section on the plan. The feature's own crumb is its number: the title is
 * printed in full right under the crumbs, and a long title as the last crumb
 * squeezed the module's crumb to nothing on a phone.
 */
export function featureCrumbs(
  feature: Pick<PlanNode, 'number'>,
  module: PlanScope | null,
  moduleLabel: string,
): Crumb[] {
  return [
    { label: 'Dev', href: '/dev' },
    { label: 'Plan', href: '/dev/plan' },
    {
      label: moduleLabel,
      href:
        module && isProjectId(module)
          ? `/dev/projects/${module}`
          : `/dev/plan#${moduleAnchor(module)}`,
    },
    { label: `#${feature.number}`, href: featureHref(feature.number) },
  ];
}

/**
 * How the Steps tab lays the steps out (plan #1665): grouped by status, which
 * is the plain Steps tab, or as the plan's tree, one press away. Kept in the
 * address beside the tab so a reload keeps the view.
 */
export const STEPS_VIEW_PARAM = 'view';
export const STEPS_VIEWS = ['status', 'tree'] as const;
export type StepsView = (typeof STEPS_VIEWS)[number];

/** The view a `?view=` value opens: the tree when it says so, otherwise the groups. */
export function stepsViewFrom(value: string | null | undefined): StepsView {
  return value === 'tree' ? 'tree' : 'status';
}

/** The address of the Steps tab in a given view. */
export function stepsViewHref(number: number, view: StepsView): string {
  const base = `${featureHref(number)}?tab=steps`;
  return view === 'tree' ? `${base}&${STEPS_VIEW_PARAM}=tree` : base;
}

/** The groups, in the order they are listed. Done and dropped start folded. */
export const STEP_GROUPS = [
  { id: 'blocked', label: 'Blocked', folded: false },
  { id: 'in_progress', label: 'In progress', folded: false },
  { id: 'ready', label: 'Ready', folded: false },
  { id: 'not_started', label: 'Not started', folded: false },
  { id: 'done', label: 'Done', folded: true },
  { id: 'dropped', label: 'Dropped', folded: true },
] as const;
export type StepGroupId = (typeof STEP_GROUPS)[number]['id'];

/**
 * The group a health word falls in. Read off `healthOf` so a step is listed
 * under the word its own row shows: a setup job of yours or an unanswered
 * question holds work up as a block does, a claim is in progress however
 * lively its run, and a step waiting on another step or still proposed has
 * not started.
 */
export function stepGroupOf(health: PlanHealth): StepGroupId {
  switch (health) {
    case 'blocked':
    case 'setup':
    case 'unanswered':
      return 'blocked';
    case 'in_progress':
    case 'working':
    case 'quiet':
    case 'abandoned':
      return 'in_progress';
    case 'ready':
      return 'ready';
    case 'done':
    case 'answered':
      return 'done';
    case 'dropped':
      return 'dropped';
    default:
      return 'not_started';
  }
}

/** A step in a group, with the step above it when it is a substep. */
export type GroupedStep = {
  node: PlanNode;
  /** Named by its outline, `#925.3`, as its row heads itself. */
  parent: Pick<PlanNode, 'number' | 'outline' | 'title'> | null;
};

export type StepGroup = {
  id: StepGroupId;
  label: string;
  folded: boolean;
  steps: GroupedStep[];
};

/**
 * A feature's steps and substeps in status groups, each listed once, in the
 * tree's own order. A row is grouped by its own status, not by what is open
 * beneath it: its substeps are listed in their own groups. Questions are not
 * rows of their own, as in the tree; they stay with the step they were asked
 * on. Groups with nothing in them are not returned.
 */
export function stepGroups(feature: PlanNode, liveness?: PlanLiveness): StepGroup[] {
  const found: GroupedStep[] = [];
  const walk = (nodes: readonly PlanNode[], parent: PlanNode | null) => {
    for (const node of nodes) {
      if (node.kind === 'decision') continue;
      found.push({
        node,
        parent: parent && { number: parent.number, outline: parent.outline, title: parent.title },
      });
      walk(node.children, node);
    }
  };
  walk(feature.children, null);
  return STEP_GROUPS.map((group) => ({
    ...group,
    steps: found.filter(({ node }) => stepGroupOf(healthOf(asListed(node), liveness)) === group.id),
  })).filter((group) => group.steps.length > 0);
}

/**
 * A step as the grouped list draws it: its questions kept, since they are
 * answered from its panel, and its substeps taken off, since they are listed
 * in their own groups. Its health is then the word its row shows.
 */
export function asListed(node: PlanNode): PlanNode {
  return { ...node, children: node.children.filter((child) => child.kind === 'decision') };
}

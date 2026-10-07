import type { Crumb } from '@/components/shell/breadcrumb';
import { planRowId } from '@/lib/comments/refs';
import { isProjectId, type PlanScope } from '@/lib/plan/projects';
import { flatten, type PlanNode, type PlanSection } from '@/lib/plan/tree';
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
 * The tabs, in order. Overview is the plain address. Activity joins them
 * with plan #1667, between the two, once there is a history to show.
 */
export const FEATURE_TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
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

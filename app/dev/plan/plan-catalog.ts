/**
 * The flat list of steps the pickers choose from, and the two helpers that
 * read it.
 *
 * Its own module because both plan-view.tsx and plan-run-status.tsx need the
 * shape, and a type imported back out of the page component would make the two
 * files import each other.
 */
import type { PlanStatus } from '@/lib/plan/load';
import type { PlanScope } from '@/lib/plan/projects';
import { flattenSections, type PlanSection } from '@/lib/plan/tree';

export type PlanCatalogEntry = {
  id: string;
  number: number;
  /** Where the row sits in the tree, as the page labels it: "723.20". */
  outline: string;
  title: string;
  module: PlanScope | null;
  parentId: string | null;
  depth: number;
  status: PlanStatus;
  completedAt: string | null;
  closed: boolean;
};

// The two helpers that read it live in lib/plan/catalog.ts, typed on the
// fields they read, so the shared tree components can use them too.
export { catalogLabel, subtreeOf } from '@/lib/plan/catalog';

/**
 * Every step in the tree as the pickers list it. Off the whole plan rather
 * than a view of it, since a step may wait on one in another module.
 */
export function catalogOf(sections: readonly PlanSection[]): PlanCatalogEntry[] {
  return flattenSections(sections).map((node) => ({
    id: node.id,
    number: node.number,
    outline: node.outline,
    title: node.title,
    module: node.module,
    parentId: node.parentId,
    depth: node.depth,
    status: node.status,
    completedAt: node.completedAt,
    closed: node.status === 'done' || node.status === 'dropped',
  }));
}

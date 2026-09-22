/**
 * The flat list of steps the pickers choose from, and the two helpers that
 * read it.
 *
 * Its own module because both plan-view.tsx and plan-run-status.tsx need the
 * shape, and a type imported back out of the page component would make the two
 * files import each other.
 */
import type { ModuleId } from '@/lib/modules';
import type { PlanStatus } from '@/lib/plan/load';

export type PlanCatalogEntry = {
  id: string;
  number: number;
  /** Where the row sits in the tree, as the page labels it: "723.20". */
  outline: string;
  title: string;
  module: ModuleId | null;
  parentId: string | null;
  depth: number;
  status: PlanStatus;
  completedAt: string | null;
  closed: boolean;
};

/** Every step under this one, by id, including the one named. */
export function subtreeOf(catalog: readonly PlanCatalogEntry[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of catalog) {
      if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) {
        ids.add(entry.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** How a step reads in a picker: its depth, its number and its title. */
export function catalogLabel(entry: PlanCatalogEntry): string {
  return `${'· '.repeat(entry.depth)}#${entry.number} ${entry.title}`;
}

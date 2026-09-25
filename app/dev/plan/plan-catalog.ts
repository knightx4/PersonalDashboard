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

// The two helpers that read it live in lib/plan/catalog.ts, typed on the
// fields they read, so the shared tree components can use them too.
export { catalogLabel, subtreeOf } from '@/lib/plan/catalog';

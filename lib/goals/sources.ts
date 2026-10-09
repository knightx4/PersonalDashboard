import type { ModuleSources, Page } from '@/lib/sources/types';
import { stepHref } from '@/lib/goals/all-goals';

/**
 * Goals' own tables (lib/sources/types.ts). The goals skill reads them
 * directly, so none is listed as a source to search; the catalogue is for
 * what the other modules hold. A new goals table still goes in this list, or
 * the gate says so.
 */
const OWN = 'Goals’ own table; the goals skill reads it directly.';

/**
 * The goals rows a ref can open (lib/core/refs.ts). A goal has its own page
 * and a step is a row on its parent's, which is its goal for every step that
 * is not a sub-step (the same fallback as lib/search/sources/goals-map.ts).
 */
const PAGES: Record<string, Page> = {
  'goals.items': {
    title: 'title',
    reads: ['level', 'parent_id'],
    href: (row) =>
      row.level === 'goal' || !row.parent_id
        ? `/goals/${row.id}`
        : stepHref(String(row.parent_id), String(row.id)),
  },
  // An area has its own page (areaHref in lib/goals/all-goals.ts).
  'goals.areas': { title: 'name', href: (row) => `/goals/area/${row.id}` },
  'goals.runs': {
    title: { reads: ['summary', 'job'], of: (row) => (row.summary as string | null) || (row.job as string | null) },
    href: (row) => `/goals/runs/${row.id}`,
  },
};

export const goalsSources: ModuleSources = {
  sources: [],
  notSources: [
    'goals.areas',
    'goals.items',
    'goals.item_goals',
    'goals.dependencies',
    'goals.links',
    'goals.context',
    'goals.collections',
    'goals.collection_goals',
    'goals.records',
    'goals.readings',
    'goals.periods',
    'goals.captures',
    'goals.comments',
    'goals.suggestions',
    'goals.reviews',
    'goals.briefs',
    'goals.runs',
    'goals.history',
    'goals.visits',
    'goals.answers',
    'goals.document_kinds',
    'goals.progress_entries',
  ].map((table) => ({ table, reason: OWN, page: PAGES[table] })),
};

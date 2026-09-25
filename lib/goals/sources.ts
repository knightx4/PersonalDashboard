import type { ModuleSources } from '@/lib/sources/types';

/**
 * Goals' own tables (lib/sources/types.ts). The goals skill reads them
 * directly, so none is listed as a source to search; the catalogue is for
 * what the other modules hold. A new goals table still goes in this list, or
 * the gate says so.
 */
const OWN = 'Goals’ own table; the goals skill reads it directly.';

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
    'goals.runs',
    'goals.history',
    'goals.visits',
  ].map((table) => ({ table, reason: OWN })),
};

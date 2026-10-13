import type { ModuleSources } from '@/lib/sources/types';

/**
 * You's tables, as Goals and Dash read them (lib/sources/types.ts). A new
 * table in you goes in one of these two lists, or the gate says so.
 */
export const youSources: ModuleSources = {
  sources: [
    {
      table: 'you.places',
      module: 'You',
      holds: 'The places they have lived, with when they moved in and out.',
      weight: 'record',
      search: ['name', 'city', 'region', 'country', 'note'],
      title: 'name',
      facts: ['moved_in', 'moved_out'],
      newest: 'moved_in',
      href: (id) => `/you/places/${id}`,
      note: 'moved_in and moved_out are a year (YYYY) or a month (YYYY-MM); no moved_out means they live there now. A place counts for a year when it was moved into that year or before and left that year or after.',
    },
  ],
  notSources: [],
};

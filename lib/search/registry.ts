import 'server-only';

import type { SearchSource } from '@/lib/search/sources';

/**
 * Every search source there is, in one place.
 *
 * Adding one is a file under sources/ and a line here. Nothing else changes --
 * not the endpoint, not the merge, not the palette -- which is what the
 * interface was for.
 *
 * Empty for now: the contract and the fan-out are built and tested first, and
 * the sources land next, so a broken source is never the thing that proves the
 * plumbing wrong.
 */
const SOURCES: SearchSource[] = [];

export function allSearchSources(): SearchSource[] {
  return SOURCES;
}

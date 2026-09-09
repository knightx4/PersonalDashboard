import 'server-only';

import type { SearchSource } from '@/lib/search/sources';
import { jobsSearchSource } from '@/lib/search/sources/jobs';
import { shoppingSearchSource } from '@/lib/search/sources/shopping';

/**
 * Every search source there is, in one place.
 *
 * Adding one is a file under sources/ and a line here. Nothing else changes --
 * not the endpoint, not the merge, not the palette -- which is what the
 * interface was for.
 *
 * Order is not significant: the merge ranks everything against the query, so
 * where a hit came from never decides where it sits.
 */
const SOURCES: SearchSource[] = [jobsSearchSource, shoppingSearchSource];

export function allSearchSources(): SearchSource[] {
  return SOURCES;
}

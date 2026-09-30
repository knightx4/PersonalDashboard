import 'server-only';

import type { SearchSource } from '@/lib/search/sources';
import { devSearchSource } from '@/lib/search/sources/dev';
import { educationSearchSource } from '@/lib/search/sources/education';
import { jobsSearchSource } from '@/lib/search/sources/jobs';
import { goalsSearchSource } from '@/lib/search/sources/goals';
import { learnSearchSource } from '@/lib/search/sources/learn';
import { newsSearchSource } from '@/lib/search/sources/news';
import { shoppingSearchSource } from '@/lib/search/sources/shopping';
import { todoSearchSource } from '@/lib/search/sources/todo';
import { vaultSearchSource } from '@/lib/search/sources/vault';

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
const SOURCES: SearchSource[] = [
  jobsSearchSource,
  shoppingSearchSource,
  todoSearchSource,
  vaultSearchSource,
  educationSearchSource,
  learnSearchSource,
  devSearchSource,
  newsSearchSource,
  goalsSearchSource,
];

export function allSearchSources(): SearchSource[] {
  return SOURCES;
}

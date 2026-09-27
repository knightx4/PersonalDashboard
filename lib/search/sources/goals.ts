import 'server-only';

import { createGoalsClient } from '@/lib/goals/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { LIST_LIMIT } from '@/lib/search/sources';
import { goalHits, type GoalItemRow } from '@/lib/search/sources/goals-map';

/**
 * Goals and their steps, in the command palette (plan #1087).
 *
 * One read of every live item, through the session client so RLS decides
 * whose. The titles are matched in goals-map.ts rather than with `ilike`
 * because a step's hit needs its goal, which can be several parents up, and
 * the whole tree is a few hundred rows at most -- one read of all of it is
 * cheaper than an `ilike` followed by a walk up the parents.
 */

type Read = SearchListContext & { query?: string };

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createGoalsClient();
  const { data, error } = await supabase
    .from('items')
    .select('id, level, parent_id, title, status, kind')
    .is('archived_at', null)
    .is('merged_into', null)
    .is('dismissed_at', null)
    .order('updated_at', { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw new Error(`items: ${error.message}`);

  return goalHits((data ?? []) as GoalItemRow[], { query: ctx.query, limit: ctx.limit });
}

export const goalsSearchSource: SearchSource = {
  id: 'goals',
  module: 'goals',
  label: 'Goals',
  kinds: ['goal', 'step'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};

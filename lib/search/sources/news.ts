import 'server-only';

import { createNewsClient } from '@/lib/news/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { storyHits, type IssueRow } from '@/lib/search/sources/news-map';

/**
 * Newsletter stories, in the command palette (plan #1087).
 *
 * Through the session client, so RLS decides whose issues come back. Only
 * summarised issues carry stories, and only the newest few hundred are read:
 * the headline is matched in news-map.ts rather than in the database, so the
 * read has to be bounded by something other than the match.
 */

/** Issues read per search. An account receives a few a day. */
const ISSUES_READ = 300;

type Read = SearchListContext & { query?: string };

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createNewsClient();
  const { data, error } = await supabase
    .from('issues')
    .select('id, subject, stories')
    .not('stories', 'is', null)
    .order('received_at', { ascending: false })
    .limit(ISSUES_READ);

  if (error) throw new Error(`issues: ${error.message}`);

  return storyHits((data ?? []) as IssueRow[], { query: ctx.query, limit: ctx.limit });
}

export const newsSearchSource: SearchSource = {
  id: 'news',
  module: 'news',
  label: 'News',
  kinds: ['story'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};

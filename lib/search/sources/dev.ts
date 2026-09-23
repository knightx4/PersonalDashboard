import 'server-only';

import { createClient } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { SPECS } from '@/lib/specs/registry';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { escapeLike } from '@/lib/search/sources/map';
import { devHits, type DevRows } from '@/lib/search/sources/dev-map';

/**
 * The Dev workspace, in the search: the plan, the specs, the ideas and your
 * own notes (note a98cc0a8).
 *
 * Owner-only, like the workspace. Row security already keeps another account
 * to its own rows, but a hit for a page that account cannot open is a hit
 * that leads nowhere, so the source answers nobody else at all.
 *
 * Specs are files in the repository rather than rows, so they are matched
 * here against the registry's title and blurb instead of in the database.
 */

/** A search, or -- with no query -- everything. */
type Read = SearchListContext & { query?: string };

async function read(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();
  if (!(await isOwner({ supabase }))) return [];

  const pattern = ctx.query ? `%${escapeLike(ctx.query)}%` : null;
  // "#612" or "612" is how a step is quoted everywhere else, and the number is
  // not in the title for `ilike` to find.
  const number = ctx.query?.match(/^#?(\d+)$/)?.[1];

  let plan = supabase
    .from('plan_items')
    .select('id, number, title, parent_id, status')
    .eq('user_id', ctx.userId)
    .neq('kind', 'decision');
  if (number) plan = plan.eq('number', Number(number));
  else if (pattern) plan = plan.ilike('title', pattern);

  let ideas = supabase
    .from('ideas')
    .select('id, body, module')
    .eq('user_id', ctx.userId)
    .is('dismissed_at', null);
  if (pattern) ideas = ideas.ilike('body', pattern);

  let notes = supabase
    .from('feedback_items')
    .select('id, body, kind, status')
    .eq('user_id', ctx.userId);
  if (pattern) notes = notes.ilike('body', pattern);

  const [planRead, ideaRead, noteRead] = await Promise.all([
    plan.order('updated_at', { ascending: false }).limit(ctx.limit),
    ideas.order('updated_at', { ascending: false }).limit(ctx.limit),
    notes.order('created_at', { ascending: false }).limit(ctx.limit),
  ]);

  if (planRead.error) throw new Error(`plan_items: ${planRead.error.message}`);
  if (ideaRead.error) throw new Error(`ideas: ${ideaRead.error.message}`);
  if (noteRead.error) throw new Error(`feedback_items: ${noteRead.error.message}`);

  const needle = ctx.query?.toLowerCase();
  const specs = SPECS.filter(
    (spec) =>
      !needle || `${spec.title} ${spec.blurb}`.toLowerCase().includes(needle),
  ).slice(0, ctx.limit);

  const rows: DevRows = {
    plan: (planRead.data ?? []) as DevRows['plan'],
    ideas: (ideaRead.data ?? []) as DevRows['ideas'],
    notes: (noteRead.data ?? []) as DevRows['notes'],
    specs,
  };
  return devHits(rows);
}

export const devSearchSource: SearchSource = {
  id: 'dev',
  module: 'dev',
  label: 'Dev',
  kinds: ['plan', 'spec', 'idea', 'feedback'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};

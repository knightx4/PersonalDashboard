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
import { devHits, matchWaiting, type DevRows } from '@/lib/search/sources/dev-map';

/**
 * The Dev workspace, in the search: the plan, the specs, the ideas, your own
 * notes (note a98cc0a8), and the questions and raises waiting on you on the
 * Dash tab (plan #1154).
 *
 * Owner-only, like the workspace. Row security already keeps another account
 * to its own rows, but a hit for a page that account cannot open is a hit
 * that leads nowhere, so the source answers nobody else at all.
 *
 * Specs are files in the repository rather than rows, so they are matched
 * here against the registry's title and blurb instead of in the database.
 *
 * Open questions and raises are few -- the Dash tab reads at most two hundred
 * raises and there are seldom more than a handful of questions -- so they are
 * read whole and matched in memory (dev-map.ts), across the title and the
 * text beneath it.
 * One `ilike` per column would be three reads for a raise, and an `or` filter
 * breaks on a query with a comma or a bracket in it. Dismissed ones are left
 * out: putting a row aside is saying you do not want it put in front of you.
 */

/** As many open questions and raises as are read before matching. */
const WAITING_READ = 200;

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
  // Questions still waiting on an answer. An answered one is history, and the
  // Dash tab, where a hit on one lands, no longer draws it.
  const questions = supabase
    .from('plan_items')
    .select('id, number, title, detail')
    .eq('user_id', ctx.userId)
    .eq('kind', 'decision')
    .not('status', 'in', '(done,dropped)')
    .is('dismissed_at', null)
    .order('updated_at', { ascending: false })
    .limit(WAITING_READ);
  // The raises the Dash tab draws: not dismissed, and not a goal's flag, which
  // is shown and answered on the Goals pages instead (the same filter as
  // loadRaised).
  const raises = supabase
    .from('raised_items')
    .select('id, title, detail, ask, status')
    .eq('user_id', ctx.userId)
    .neq('status', 'dismissed')
    .is('goal_id', null)
    .order('created_at', { ascending: false })
    .limit(WAITING_READ);
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

  const [planRead, ideaRead, noteRead, questionRead, raiseRead] = await Promise.all([
    plan.order('updated_at', { ascending: false }).limit(ctx.limit),
    ideas.order('updated_at', { ascending: false }).limit(ctx.limit),
    notes.order('created_at', { ascending: false }).limit(ctx.limit),
    questions,
    raises,
  ]);

  if (planRead.error) throw new Error(`plan_items: ${planRead.error.message}`);
  if (ideaRead.error) throw new Error(`ideas: ${ideaRead.error.message}`);
  if (noteRead.error) throw new Error(`feedback_items: ${noteRead.error.message}`);
  if (questionRead.error) throw new Error(`plan_items: ${questionRead.error.message}`);
  if (raiseRead.error) throw new Error(`raised_items: ${raiseRead.error.message}`);

  const needle = ctx.query?.toLowerCase();
  const specs = SPECS.filter(
    (spec) =>
      !needle || `${spec.title} ${spec.blurb}`.toLowerCase().includes(needle),
  ).slice(0, ctx.limit);

  const matched = matchWaiting(
    {
      questions: (questionRead.data ?? []) as NonNullable<DevRows['questions']>,
      raises: (raiseRead.data ?? []) as NonNullable<DevRows['raises']>,
    },
    ctx.query,
    ctx.limit,
  );

  const rows: DevRows = {
    plan: (planRead.data ?? []) as DevRows['plan'],
    ideas: (ideaRead.data ?? []) as DevRows['ideas'],
    notes: (noteRead.data ?? []) as DevRows['notes'],
    specs,
    ...matched,
  };
  return devHits(rows);
}

export const devSearchSource: SearchSource = {
  id: 'dev',
  module: 'dev',
  label: 'Dev',
  kinds: ['plan', 'spec', 'idea', 'feedback', 'raise'],

  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};

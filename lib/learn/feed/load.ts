import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { ACTION_FROM, FEED_PAGE, toFeedCard, type FeedAction, type FeedCard, type FeedCardRow } from './card';

/**
 * Reading and marking Learn now cards through the person's own session
 * (plan #808). RLS limits every read and update here to their own rows, so
 * nothing filters on the user id.
 */

const CARD_SELECT =
  'id, reason, status, summary, why, ' +
  'item:catalogue_items!feed_cards_item_id_fkey(title, canonical_url, licence), ' +
  'segment:catalogue_segments!feed_cards_segment_id_fkey(heading, text, section_anchor)';

/** The most card ids a request excludes. Past this, the oldest shown come back. */
const MAX_EXCLUDED = 300;

/**
 * The next ready cards, newest first, leaving out the ones already on the
 * screen. Only `ready` cards, so one you pressed Next on (`passed`) or acted on
 * is not shown again. Newest first so a card the top-up has just written comes
 * up before one you scrolled past on an earlier visit.
 */
export async function loadFeedPage(
  supabase: LearnSupabaseClient,
  exclude: string[],
  limit: number = FEED_PAGE,
): Promise<FeedCard[]> {
  let query = supabase
    .from('feed_cards')
    .select(CARD_SELECT)
    .eq('status', 'ready')
    .order('written_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(limit);
  const skip = exclude.slice(-MAX_EXCLUDED);
  if (skip.length > 0) query = query.not('id', 'in', `(${skip.join(',')})`);

  const { data, error } = await query;
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading your cards failed: ${error.message}`);
  return ((data ?? []) as unknown as FeedCardRow[]).flatMap((row) => {
    const card = toFeedCard(row);
    return card ? [card] : [];
  });
}

/** How many cards are ready, for the foot of the feed. */
export async function countReadyCards(supabase: LearnSupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('feed_cards')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ready');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) return 0;
  return count ?? 0;
}

export type FeedCardDetail = FeedCardRow & { item_id: string; subject_id: string | null };

/** One card with its catalogue parts, or null when it is not yours or not shown. */
export async function loadFeedCardRow(
  supabase: LearnSupabaseClient,
  id: string,
): Promise<FeedCardDetail | null> {
  const { data, error } = await supabase
    .from('feed_cards')
    .select(`${CARD_SELECT}, item_id, subject_id`)
    .eq('id', id)
    .maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading that card failed: ${error.message}`);
  return (data as unknown as FeedCardDetail | null) ?? null;
}

/**
 * Record an action on a card: its status, when, and what it made. Next is one
 * of these (`passed`), and takes the card out of the ready pool like the rest.
 *
 * Only from the statuses `ACTION_FROM` allows, so the first decision on a card
 * stands. Returns whether the row moved; a card already decided returns false
 * and is left as it was.
 */
export async function recordFeedAction(
  supabase: LearnSupabaseClient,
  id: string,
  action: FeedAction,
  made: { saved_reading_id?: string; subject_id?: string } = {},
): Promise<boolean> {
  const { data, error } = await supabase
    .from('feed_cards')
    .update({ status: action, acted_at: new Date().toISOString(), ...made })
    .eq('id', id)
    .in('status', [...ACTION_FROM[action]])
    .select('id');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Recording that failed: ${error.message}`);
  return (data ?? []).length > 0;
}

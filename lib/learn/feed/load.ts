import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  ACTION_FROM,
  FEED_PAGE,
  RETURN_AFTER_DAYS,
  toFeedCard,
  type CardDifficulty,
  type FeedAction,
  type FeedCard,
  type FeedCardRow,
} from './card';
import { ARTICLE_GAP, POOL_FACTOR, spreadDeck, type Spreadable } from './spread';

/**
 * Reading and marking Learn now cards through the person's own session
 * (plan #808). RLS limits every read and update here to their own rows, so
 * nothing filters on the user id.
 */

const CARD_SELECT =
  'id, reason, status, idea_name, theme_name, aim_name, field_id, summary, why, takeaway, context, hook, example, check_question, check_answer, depth, difficulty, ' +
  'item:catalogue_items!feed_cards_item_id_fkey(title, canonical_url, licence), ' +
  'segment:catalogue_segments!feed_cards_segment_id_fkey(heading, text, section_anchor)';

/** The most card ids a request excludes. Past this, the oldest shown come back. */
const MAX_EXCLUDED = 300;

/** When a card swiped with `status` last acted on before this may come back. */
function returnCutoff(status: 'review' | 'skipped', now: number): string {
  return new Date(now - RETURN_AFTER_DAYS[status] * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The next cards for the deck, leaving out the ones already on the screen.
 *
 * Cards you swiped "work on this" come first once their two days are up, then
 * the ready cards newest first, so a card the top-up has just written comes
 * up before one you passed on an earlier visit, then cards you skipped once
 * their three days are up.
 *
 * Only cards with a hook: a card written before cards carried one is the
 * summary-only card the owner asked to stop seeing (LEARN-NOW-SPEC, "Cards
 * after the first week"). A ready card also needs its context paragraph, so
 * new cards always open by saying what they are about; a card coming back
 * after a skip or "work on this" is shown without one if it was written
 * before the paragraph existed.
 *
 * The page is dealt from a pool several times its size, so two cards from one
 * article, such as two ideas from one section, are kept apart, and two cards
 * for one theme are not back to back where another will do (spread.ts). The
 * cards the page already holds are the last ids in `exclude`, in deck order,
 * so a later page carries on the spacing.
 */
export async function loadFeedPage(
  supabase: LearnSupabaseClient,
  exclude: string[],
  limit: number = FEED_PAGE,
  now: number = Date.now(),
): Promise<FeedCard[]> {
  const skip = exclude.slice(-MAX_EXCLUDED);
  const read = async (
    status: 'ready' | 'review' | 'skipped',
    count: number,
    taken: string[],
  ): Promise<FeedCardRow[]> => {
    if (count <= 0) return [];
    // A new ready card needs its context paragraph; a returning one does not.
    // Written as one `or` because a second `.not` here makes the query
    // builder's types recurse too deeply; `id` is never null, so the other
    // branch lets every row through.
    let query = supabase
      .from('feed_cards')
      .select(CARD_SELECT)
      .eq('status', status)
      .not('hook', 'is', null)
      .or(status === 'ready' ? 'context.not.is.null' : 'id.not.is.null');
    if (status === 'ready') {
      query = query.order('written_at', { ascending: false, nullsFirst: false });
    } else {
      query = query
        .lt('acted_at', returnCutoff(status, now))
        .order('acted_at', { ascending: true });
    }
    const leaveOut = [...skip, ...taken];
    if (leaveOut.length > 0) query = query.not('id', 'in', `(${leaveOut.join(',')})`);
    const { data, error } = await query.order('id').limit(count);
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw new Error(`Reading your cards failed: ${error.message}`);
    return (data ?? []) as unknown as FeedCardRow[];
  };

  const pool = limit * POOL_FACTOR;
  const rows: FeedCardRow[] = [];
  for (const status of ['review', 'ready', 'skipped'] as const) {
    rows.push(
      ...(await read(
        status,
        pool - rows.length,
        rows.map((row) => row.id),
      )),
    );
  }
  const dealable = rows.flatMap((row) => {
    const card = toFeedCard(row);
    return card ? [{ card, article: card.article, target: targetOf(row) }] : [];
  });
  const recent = await recentInDeck(supabase, exclude.slice(-ARTICLE_GAP));
  return spreadDeck(dealable, recent, limit).map((dealt) => dealt.card);
}

/** What a card was picked for, for keeping two on one theme apart. */
function targetOf(row: FeedCardRow): string | null {
  return row.theme_name ?? row.aim_name ?? row.field_id ?? null;
}

/** The article and target of the cards last dealt, oldest first. */
async function recentInDeck(supabase: LearnSupabaseClient, ids: string[]): Promise<Spreadable[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('feed_cards')
    .select('id, theme_name, aim_name, field_id, item:catalogue_items!feed_cards_item_id_fkey(title)')
    .in('id', ids);
  // Only spacing is lost without it, so a failed read deals the page as though fresh.
  if (error) return [];
  const byId = new Map(
    ((data ?? []) as unknown as (Pick<FeedCardRow, 'theme_name' | 'aim_name' | 'field_id'> & {
      id: string;
      item: { title: string } | null;
    })[]).map((row) => [row.id, { article: row.item?.title ?? '', target: targetOf(row as FeedCardRow) }]),
  );
  return ids.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
}

/** How many cards are ready, for the foot of the feed. */
export async function countReadyCards(supabase: LearnSupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('feed_cards')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ready')
    .not('hook', 'is', null)
    .not('context', 'is', null);
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
 * Record a deliberate action on a card: its status, when, and what it made.
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

/**
 * Set, change or clear the person's too hard or too easy rating on a card
 * (plan #890). Any status will do: the rating does not decide the card.
 * Returns whether a row was written; RLS hides another account's card, so
 * that returns false and nothing changes.
 */
export async function setCardDifficulty(
  supabase: LearnSupabaseClient,
  id: string,
  difficulty: CardDifficulty | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('feed_cards')
    .update({ difficulty })
    .eq('id', id)
    .select('id');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Recording that failed: ${error.message}`);
  return (data ?? []).length > 0;
}

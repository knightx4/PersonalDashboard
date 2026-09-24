'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { topUpFeedAfterResponse } from '@/inngest/learn/feed-top-up';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import {
  ACTION_FROM,
  cardTitle,
  isCardDifficulty,
  sectionLink,
  SWIPES,
  type CardDifficulty,
  type FeedCard,
  type SwipeAction,
} from '@/lib/learn/feed/card';
import {
  countReadyCards,
  loadFeedCardRow,
  loadFeedPage,
  recordFeedAction,
  setCardDifficulty,
} from '@/lib/learn/feed/load';
import { startTrackFromCard } from '@/lib/learn/feed/test-me';
import { SAVED_FROM_FEED, saveFeedSection } from '@/lib/learn/tracks/save';

/**
 * The Learn now feed's actions (plan #808).
 *
 * Five of these record something, and each is deliberate: opening the
 * source, Save, Not interested, Test me on this, and the three swipes.
 * Loading more cards records nothing (LEARN-NOW-SPEC "What is recorded").
 *
 * Every action that can take a card out of the ready pool, and loading more,
 * asks for a top-up once the response has gone. It costs one count when
 * enough cards are ready, and writes fifteen more only when seven or fewer are.
 */

const CardId = z.string().uuid();
const CardIds = z.array(z.string().uuid()).max(1000);

export type MoreCards = { cards: FeedCard[]; ready: number };

// latency: pending
export async function loadMoreCards(shown: string[]): Promise<MoreCards> {
  const user = await requireUser();
  const exclude = CardIds.safeParse(shown);
  const supabase = await createLearnClient();
  const [cards, ready] = await Promise.all([
    loadFeedPage(supabase, exclude.success ? exclude.data : []),
    countReadyCards(supabase),
  ]);
  after(() => topUpFeedAfterResponse(user.id));
  return { cards, ready };
}

/**
 * Following the link to the source. The link opens on its own; this only
 * records it, and a failure here is not worth interrupting the reading for.
 */
// latency: optimistic
export async function openCardSource(id: string): Promise<void> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return;
  const supabase = await createLearnClient();
  const moved = await recordFeedAction(supabase, card.data, 'opened').catch(() => false);
  if (moved) after(() => topUpFeedAfterResponse(user.id));
}

export type CardActionResult = { error?: string };

// latency: optimistic
export async function dismissCard(id: string): Promise<CardActionResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const supabase = await createLearnClient();
  try {
    await recordFeedAction(supabase, card.data, 'dismissed');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not record that.' };
  }
  after(() => topUpFeedAfterResponse(user.id));
  return {};
}

/**
 * Too hard or too easy on a card (plan #890), or null to take the rating
 * back. The card stays where it is: rating it does not move the deck on, and
 * it asks for no top-up because no card leaves the ready pool.
 */
// latency: optimistic
export async function rateCard(
  id: string,
  difficulty: CardDifficulty | null,
): Promise<CardActionResult> {
  await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  if (difficulty !== null && !isCardDifficulty(difficulty)) {
    return { error: 'Could not tell which rating that was.' };
  }
  const supabase = await createLearnClient();
  try {
    const written = await setCardDifficulty(supabase, card.data, difficulty);
    if (!written) return { error: 'That card is no longer there.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not record that.' };
  }
  return {};
}

/**
 * One of the three swipes: down for "I'm good on this" (`known`), right for
 * "I need to work on this" (`review`), left for "not now" (`skipped`). The
 * deck moves on before this returns, so a failure only comes back as a line
 * under the next card.
 */
// latency: optimistic
export async function swipeCard(id: string, swipe: SwipeAction): Promise<CardActionResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success || !SWIPES.includes(swipe)) return { error: 'Could not tell which card that was.' };
  const supabase = await createLearnClient();
  try {
    await recordFeedAction(supabase, card.data, swipe);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not record that.' };
  }
  after(() => topUpFeedAfterResponse(user.id));
  return {};
}

export type SaveCardResult = { error?: string; list?: { id: string; title: string } };

// latency: pending
export async function saveCard(id: string): Promise<SaveCardResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const supabase = await createLearnClient();

  try {
    const row = await loadFeedCardRow(supabase, card.data);
    if (!row?.item || !row.segment || !row.why) return { error: 'That card is no longer there.' };
    // Checked before the reading is written, so a second press, or a card
    // already dismissed in another tab, does not put a row on the list.
    if (!ACTION_FROM.saved.includes(row.status)) {
      return { error: row.status === 'saved' ? 'Already saved.' : 'That card has been dealt with.' };
    }

    const saved = await saveFeedSection(supabase, user.id, {
      article: row.item.title,
      section: row.segment.heading,
      articleUrl: row.item.canonical_url.split('#')[0]!,
      link: sectionLink(row.item.canonical_url, row.segment.section_anchor),
      why: row.why,
      catalogueItemId: row.item_id,
    });
    await recordFeedAction(supabase, card.data, 'saved', { saved_reading_id: saved.readingId });
    after(() => topUpFeedAfterResponse(user.id));
    return { list: { id: saved.trackId, title: SAVED_FROM_FEED } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }
}

/**
 * Test me on this: start a track from the card and go to Practice Flow,
 * focused on it. The card is marked tested only once the track exists, so a
 * failed start leaves it ready and says why on the card.
 */
// latency: pending
export async function testMeOnCard(id: string): Promise<CardActionResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const supabase = await createLearnClient();

  const row = await loadFeedCardRow(supabase, card.data).catch(() => null);
  if (!row?.item || !row.segment) return { error: 'That card is no longer there.' };
  // Pressed again after the track was started: go back to it rather than
  // paying for a second chain.
  if (row.status === 'tested' && row.subject_id) redirect(`/learn/flow?track=${row.subject_id}`);

  const started = await startTrackFromCard(supabase, user.id, {
    title: cardTitle(row.item.title, row.segment.heading),
    article: row.item.title,
  }).catch((error: unknown) => ({
    ok: false as const,
    detail: error instanceof Error ? error.message : 'Could not start that track.',
  }));
  if (!started.ok) return { error: started.detail };

  await recordFeedAction(supabase, card.data, 'tested', { subject_id: started.subjectId }).catch(
    () => false,
  );
  after(() => topUpFeedAfterResponse(user.id));
  redirect(`/learn/flow?track=${started.subjectId}`);
}

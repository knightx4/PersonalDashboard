'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { topUpFeedAfterResponse } from '@/inngest/learn/feed-top-up';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { ACTION_FROM, cardTitle, sectionLink, type FeedCard } from '@/lib/learn/feed/card';
import { countReadyCards, loadFeedCardRow, loadFeedPage, recordFeedAction } from '@/lib/learn/feed/load';
import { startTrackFromCard } from '@/lib/learn/feed/test-me';
import { SAVED_FROM_FEED, saveFeedSection } from '@/lib/learn/tracks/save';

/**
 * The Learn now feed's actions (plan #808).
 *
 * Five of these record something, and each is a press: opening the source,
 * Next, Save, Not interested, Test me on this. Loading more cards records
 * nothing, which is how scrolling past a card stays unrecorded
 * (LEARN-NOW-SPEC "What is recorded").
 *
 * Every action that can take a card out of the ready pool, and loading more,
 * asks for a top-up once the response has gone. It costs one count when
 * enough cards are ready, and writes more only when fewer than ten are.
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
 * Next: mark the card passed so it is not shown on a later visit (plan #833).
 * A pass is not read as dislike; the draw's weighting ignores it. Only a
 * `ready` card moves, so a second call, or a card already saved, opened or
 * dismissed, changes nothing and asks for no top-up. The page moves on
 * without waiting, and a failure is not worth showing: the card would only
 * come back next visit.
 */
// latency: optimistic
export async function passCard(id: string): Promise<void> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return;
  const supabase = await createLearnClient();
  const moved = await recordFeedAction(supabase, card.data, 'passed').catch(() => false);
  if (moved) after(() => topUpFeedAfterResponse(user.id));
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

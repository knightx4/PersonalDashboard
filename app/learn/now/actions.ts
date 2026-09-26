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
import { settleIdeaFromSwipe } from '@/lib/learn/feed/ideas-store';
import { noteBody, type NoteWrite } from '@/lib/learn/notes/notes';
import { deleteNote, insertCardNote } from '@/lib/learn/notes/store';
import { startTrackFromCard } from '@/lib/learn/feed/test-me';
import { makeTrackFromCard, startTrackFromOffer } from '@/lib/learn/lessons/new-track';
import { recordRestingPress } from '@/lib/learn/lessons/resting-load';
import { loadUnitForCheck, markUnitConceptsTested } from '@/lib/learn/lessons/unit-check-store';
import { markUnitCheck } from '@/lib/learn/lessons/write-unit-check';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { SAVED_FROM_FEED, saveFeedSection } from '@/lib/learn/tracks/save';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { cardMaterial, CARD_REPLY_GUIDANCE } from '@/lib/learn/feed/ask';
import { turnBody, type TalkSubject, type TalkTurn } from '@/lib/talk/talk';
import { appendTurns, loadConversation } from '@/lib/talk/store';
import { replyAbout } from '@/lib/talk/reply';

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

/**
 * A note written on a card (plan #1058), kept against the card and the idea
 * it teaches. The card is read back rather than trusted from the page, so the
 * idea comes from the card's own row and RLS has said the card is yours.
 * Writing a note moves nothing in the deck.
 */
// latency: pending
export async function addCardNote(id: string, body: string): Promise<NoteWrite> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const parsed = noteBody(body);
  if ('error' in parsed) return { error: parsed.error };
  const supabase = await createLearnClient();
  try {
    const note = await insertCardNote(supabase, user.id, card.data, parsed.body);
    return note ? { note } : { error: 'That card is no longer there.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'That note was not kept.' };
  }
}

/** Deletes one of your notes, from a card or from an idea's page. */
// latency: pending
export async function deleteCardNote(id: string): Promise<CardActionResult> {
  await requireUser();
  const note = CardId.safeParse(id);
  if (!note.success) return { error: 'Could not tell which note that was.' };
  const supabase = await createLearnClient();
  try {
    await deleteNote(supabase, note.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'That note was not deleted.' };
  }
  return {};
}

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
  // What the swipe says about the card's idea (LEARN-NOW-SPEC, "Where ideas
  // are kept"). Never fails the swipe.
  await settleIdeaFromSwipe(supabase, user.id, card.data, swipe);
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
    // A lesson saves the section it cites, and has nothing to save without one.
    const item = row?.item ?? row?.source_item ?? null;
    const segment = row?.item ? row.segment : (row?.source_segment ?? null);
    const itemId = row?.item_id ?? row?.source_item_id ?? null;
    if (!row || !item || !segment || !itemId || !row.why) return { error: 'That card is no longer there.' };
    // Checked before the reading is written, so a second press, or a card
    // already dismissed in another tab, does not put a row on the list.
    if (!ACTION_FROM.saved.includes(row.status)) {
      return { error: row.status === 'saved' ? 'Already saved.' : 'That card has been dealt with.' };
    }

    const saved = await saveFeedSection(supabase, user.id, {
      article: item.title,
      section: segment.heading,
      articleUrl: item.canonical_url.split('#')[0]!,
      link: sectionLink(item.canonical_url, segment.section_anchor),
      why: row.why,
      catalogueItemId: itemId,
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
 * failed start leaves it ready and says why on the card. A lesson is already
 * in a track, so it goes straight to that track's Practice Flow.
 */
// latency: pending
export async function testMeOnCard(id: string): Promise<CardActionResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const supabase = await createLearnClient();

  const row = await loadFeedCardRow(supabase, card.data).catch(() => null);
  if (row?.reason === 'lesson') {
    if (!row.subject_id) return { error: 'The track this lesson was from is no longer there.' };
    if (ACTION_FROM.tested.includes(row.status)) {
      await recordFeedAction(supabase, card.data, 'tested').catch(() => false);
      after(() => topUpFeedAfterResponse(user.id));
    }
    redirect(`/learn/flow?track=${row.subject_id}`);
  }
  if (!row?.item || !row.segment) return { error: 'That card is no longer there.' };
  // Pressed again after the track was started: go back to it rather than
  // paying for a second chain.
  if (row.status === 'tested' && row.subject_id) redirect(`/learn/flow?track=${row.subject_id}`);

  const started = await startTrackFromCard(supabase, user.id, {
    // The idea is what "this" is on an idea card; older cards are the section.
    title: row.idea_name?.trim() || cardTitle(row.item.title, row.segment.heading),
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

export type NewTrackResult = { error?: string; track?: { id: string; name: string; units: number } };

/**
 * Start, on the track offer in Learn now (plan #968). The track is written
 * with its chain and its curriculum while you wait, and its lessons come into
 * the feed from the top-up afterwards. Not now and Never are Practice Flow's
 * own `answerTrackOffer`, so both are honoured the same way in either place.
 */
// latency: pending
export async function startTrackOffer(themeId: string): Promise<NewTrackResult> {
  const user = await requireUser();
  const theme = CardId.safeParse(themeId);
  if (!theme.success) return { error: 'Could not tell which theme that was.' };

  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const started = await startTrackFromOffer(supabase, vault, user.id, theme.data).catch(
    (error: unknown) => ({
      ok: false as const,
      detail: error instanceof Error ? error.message : 'Could not start that track.',
    }),
  );
  if (!started.ok) return { error: started.detail };

  after(() => topUpFeedAfterResponse(user.id));
  return { track: { id: started.subjectId, name: started.name, units: started.units } };
}

/**
 * Make this a track, on an exploratory card (plan #968). The card's article
 * becomes a track with a curriculum, and the card is marked tested with the
 * track on it, as Test me on this marks it: both turn the card into a track,
 * and nothing moves a card out of `tested`. Pressed again, it names the track
 * already made rather than paying for another curriculum.
 */
// latency: pending
export async function makeTrackOfCard(id: string): Promise<NewTrackResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const supabase = await createLearnClient();

  const row = await loadFeedCardRow(supabase, card.data).catch(() => null);
  if (!row?.item || !row.segment || row.reason === 'lesson') {
    return { error: 'That card is no longer there.' };
  }
  if (row.status === 'tested' && row.subject_id) {
    return { track: { id: row.subject_id, name: row.item.title, units: 0 } };
  }

  const made = await makeTrackFromCard(supabase, user.id, {
    article: row.item.title,
    idea: row.idea_name?.trim() || cardTitle(row.item.title, row.segment.heading),
  }).catch((error: unknown) => ({
    ok: false as const,
    detail: error instanceof Error ? error.message : 'Could not make that track.',
  }));
  if (!made.ok) return { error: made.detail };

  if (ACTION_FROM.tested.includes(row.status)) {
    await recordFeedAction(supabase, card.data, 'tested', { subject_id: made.subjectId }).catch(
      () => false,
    );
  }
  after(() => topUpFeedAfterResponse(user.id));
  return { track: { id: made.subjectId, name: made.name, units: made.units } };
}

export type AskResult = { turns?: TalkTurn[]; error?: string };

/**
 * Ask about this card (plan #1052). The question is kept before Dash is asked,
 * so a failed reply or a closed tab leaves it in the thread; the reply is kept
 * when it comes. Dash is given the card's own text and the passage it was
 * written from, and told to say when a question goes past them.
 */
// latency: pending
export async function askAboutCard(id: string, question: string): Promise<AskResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const checked = turnBody(question);
  if ('error' in checked) return { error: checked.error };

  const supabase = await createLearnClient();
  const row = await loadFeedCardRow(supabase, card.data).catch(() => null);
  const material = row ? cardMaterial(row) : null;
  if (!material) return { error: 'That card is no longer there.' };

  const core = await createCoreClient();
  const subject: TalkSubject = { kind: 'feed_card', ref: card.data, title: material.title };
  let earlier: TalkTurn[];
  let asked: TalkTurn[];
  try {
    earlier = await loadConversation(core, subject);
    asked = await appendTurns(core, user.id, subject, [{ role: 'user', body: checked.body }]);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Keeping your question failed.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { turns: asked, error: 'Answering needs ANTHROPIC_API_KEY to be set.' };

  const spend = collectSpend();
  const reply = await replyAbout({
    subject: { kind: 'feed_card', title: material.title, material: material.text },
    turns: [...earlier, ...asked],
    guidance: CARD_REPLY_GUIDANCE,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'reply-about-card', spend.reports);
  if (!reply.ok) return { turns: asked, error: `Dash could not answer: ${reply.detail}` };

  try {
    const answered = await appendTurns(core, user.id, subject, [
      { role: 'assistant', body: reply.reply },
    ]);
    return { turns: [...asked, ...answered] };
  } catch (error) {
    return {
      turns: asked,
      error: error instanceof Error ? error.message : 'Keeping the answer failed.',
    };
  }
}

export type UnitCheckResult = {
  error?: string;
  marked?: {
    correct: boolean;
    /** The marker's one sentence on the answer. */
    why: string;
    /** The answer the check expected, shown once it is answered. */
    expected: string;
    /** Concepts marked tested by a right answer. */
    tested: number;
  };
};

const CheckResponse = z.string().trim().min(1).max(2000);

type CheckRow = {
  reason: string;
  status: string;
  track_name: string | null;
  unit_id: string | null;
  check_question: string | null;
  check_answer: string | null;
  check_concept_ids: string[] | null;
  check_correct: boolean | null;
  check_marked_why: string | null;
};

/**
 * Check my answer, on a unit check (LEARN-LESSONS-SPEC, "The unit check";
 * plan #971). Haiku marks what was written against the unit's outcome, the
 * card is marked tested with the answer and the mark on it, and a right answer
 * marks the unit's concepts tested. A wrong one changes nothing about them.
 * Skip is Not interested (`dismissCard`): the unit stays done either way.
 */
// latency: pending
export async function answerUnitCheck(id: string, response: string): Promise<UnitCheckResult> {
  const user = await requireUser();
  const card = CardId.safeParse(id);
  if (!card.success) return { error: 'Could not tell which card that was.' };
  const answer = CheckResponse.safeParse(response);
  if (!answer.success) return { error: 'Write an answer first, in a sentence or two.' };
  const supabase = await createLearnClient();

  const { data, error } = await supabase
    .from('feed_cards')
    .select(
      'reason, status, track_name, unit_id, check_question, check_answer, check_concept_ids, check_correct, check_marked_why',
    )
    .eq('id', card.data)
    .maybeSingle();
  if (error) return { error: `Reading that card failed: ${error.message}` };
  const row = data as CheckRow | null;
  if (!row || row.reason !== 'unit_check' || !row.check_question || !row.check_answer || !row.unit_id) {
    return { error: 'That check is no longer there.' };
  }
  // Answered already, in another tab: show that mark rather than paying for another.
  if (row.status === 'tested' && row.check_correct !== null) {
    return {
      marked: { correct: row.check_correct, why: row.check_marked_why ?? '', expected: row.check_answer, tested: 0 },
    };
  }
  if (!ACTION_FROM.tested.includes(row.status)) return { error: 'That check has been dealt with.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Marking an answer needs ANTHROPIC_API_KEY to be set.' };

  const conceptIds = row.check_concept_ids ?? [];
  try {
    const unit = await loadUnitForCheck(supabase, user.id, {
      unitId: row.unit_id,
      trackName: row.track_name ?? '',
      conceptIds,
    });
    if (!unit) return { error: 'The unit this check was for is no longer there.' };

    const spend = collectSpend();
    const grade = await markUnitCheck({
      unit,
      question: row.check_question,
      expected: row.check_answer,
      response: answer.data,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'mark-unit-check', spend.reports);
    if (!grade.ok) return { error: `Marking failed: ${grade.detail}` };

    const { data: moved, error: moveError } = await supabase
      .from('feed_cards')
      .update({
        status: 'tested',
        acted_at: new Date().toISOString(),
        check_response: answer.data,
        check_correct: grade.correct,
        check_marked_why: grade.why,
      })
      .eq('id', card.data)
      .in('status', [...ACTION_FROM.tested])
      .select('id');
    if (moveError) return { error: `Recording the answer failed: ${moveError.message}` };
    // Another press got there first and recorded its own mark.
    if ((moved ?? []).length === 0) return { error: 'That check has been dealt with.' };

    const tested = grade.correct ? await markUnitConceptsTested(supabase, user.id, conceptIds) : 0;
    after(() => topUpFeedAfterResponse(user.id));
    return { marked: { correct: grade.correct, why: grade.why, expected: row.check_answer, tested } };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not mark that.' };
  }
}

const RestingAnswer = z.enum(['picked_up', 'not_now', 'rested']);

/**
 * Pick it up, Not now or Let it rest, on a resting track offered back in
 * Learn now (plan #1045). Each is kept in `learn.track_offers` as a `resting`
 * row; what each one does is in `lib/learn/lessons/resting.ts`. Pick it up
 * asks for a top-up once the response has gone, so the track's next lesson is
 * written then rather than on the next hourly run.
 */
// latency: optimistic
export async function answerRestingTrack(
  subjectId: string,
  outcome: string,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const track = CardId.safeParse(subjectId);
  const answer = RestingAnswer.safeParse(outcome);
  if (!track.success || !answer.success) return { error: 'Could not tell which track that was.' };

  const supabase = await createLearnClient();
  const kept = await recordRestingPress(supabase, user.id, track.data, answer.data).catch(
    () => null,
  );
  if (kept === null) return { error: 'Could not keep that. Check your connection.' };
  if (!kept) return { error: 'That track is no longer there.' };

  if (answer.data === 'picked_up') after(() => topUpFeedAfterResponse(user.id));
  return {};
}

import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { scheduleIdeas } from '@/lib/learn/lessons/review-store';
import type { SwipeAction } from './card';
import {
  DUPLICATE_SIMILARITY,
  ideaBasis,
  NEARBY_MIN_SIMILARITY,
  sectionQueryText,
  swipeState,
  type StateBasis,
} from './ideas';
import { MAX_KNOWN_IDEAS, type IdeaCard, type KnownIdea } from './write-card';

/**
 * Reading and writing Learn now ideas as concepts (LEARN-NOW-SPEC, "Where
 * ideas are kept").
 *
 * The top-up calls the first two with the service role, which RLS does not
 * narrow, so both name the person. The swipe calls the third through the
 * person's own session.
 *
 * Nothing here may stop a card from being written or a swipe from being
 * recorded. A lookup that fails means the writing call is told of no ideas; a
 * save that fails leaves the card without a concept. Both are logged.
 */

function warn(action: string, detail: unknown): void {
  console.error(`[learn feed ideas] ${action}`, detail instanceof Error ? detail.message : detail);
}

type Nearest = { concept_id: string; name: string; claim: string; similarity: number };

async function nearest(
  learn: LearnSupabaseClient,
  userId: string,
  vector: string,
  limit: number,
  minSimilarity: number,
): Promise<Nearest[]> {
  const { data, error } = await learn.rpc('nearest_concepts', {
    for_user: userId,
    query_embedding: vector,
    match_limit: limit,
    min_similarity: minSimilarity,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Nearest[];
}

/**
 * The ideas this person already holds nearest a section, for the writing call
 * to leave out.
 *
 * Uses the section's own embedding when the catalogue has made one, and embeds
 * the start of the section otherwise.
 */
export async function nearbyIdeas(
  learn: LearnSupabaseClient,
  userId: string,
  section: { segmentId: string | null; article: string; heading: string | null; text: string },
  onSpend?: SpendSink,
): Promise<KnownIdea[]> {
  try {
    let vector: string | null = null;
    if (section.segmentId) {
      const { data } = await learn
        .from('catalogue_segments')
        .select('embedding')
        .eq('id', section.segmentId)
        .maybeSingle();
      const stored = (data as { embedding: string | null } | null)?.embedding;
      if (stored) vector = stored;
    }
    if (!vector) {
      const embedded = await embedTexts({
        texts: [sectionQueryText(section.article, section.heading, section.text)],
        inputType: 'document',
        onSpend,
      });
      if (!embedded.ok) {
        warn('embedding the section', embedded.detail);
        return [];
      }
      vector = vectorLiteral(embedded.vectors[0]!);
    }
    const found = await nearest(learn, userId, vector, MAX_KNOWN_IDEAS, NEARBY_MIN_SIMILARITY);
    return found.map((row) => ({ name: row.name, claim: row.claim }));
  } catch (error) {
    warn('finding the ideas near a section', error);
    return [];
  }
}

/**
 * The subject a feed idea is filed under: one the person chose, never a hidden
 * one made for it (plan #2313.2). In order, the subject the card was written
 * for, the subject its goal points at, and a subject of theirs named after the
 * article. Null when none of these is a chosen subject; the card's ideas are
 * then not kept as concepts.
 */
async function chosenSubjectFor(
  learn: LearnSupabaseClient,
  userId: string,
  cardId: string | null,
  article: string,
): Promise<string | null> {
  const candidates: string[] = [];
  if (cardId) {
    const { data, error } = await learn
      .from('feed_cards')
      .select('subject_id, aim_id')
      .eq('user_id', userId)
      .eq('id', cardId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const card = data as { subject_id: string | null; aim_id: string | null } | null;
    if (card?.subject_id) candidates.push(card.subject_id);
    if (card?.aim_id) {
      const { data: aim, error: aimError } = await learn
        .from('aims')
        .select('subject_id')
        .eq('user_id', userId)
        .eq('id', card.aim_id)
        .maybeSingle();
      if (aimError) throw new Error(aimError.message);
      const subjectId = (aim as { subject_id: string | null } | null)?.subject_id;
      if (subjectId) candidates.push(subjectId);
    }
  }

  const chosen = new Set<string>();
  if (candidates.length > 0) {
    const { data, error } = await learn
      .from('subjects')
      .select('id')
      .eq('user_id', userId)
      .eq('survey', false)
      .in('id', candidates);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { id: string }[]) chosen.add(row.id);
  }
  const first = candidates.find((id) => chosen.has(id));
  if (first) return first;

  const { data, error } = await learn
    .from('subjects')
    .select('id')
    .eq('user_id', userId)
    .eq('survey', false)
    .ilike('name', article)
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

/**
 * Attach a new idea to its nearest frame topic straight away, by the rule the
 * daily sweep uses (learn 0179). A failure is logged and the sweep sets it.
 */
async function attachToTopic(learn: LearnSupabaseClient, userId: string, conceptId: string): Promise<void> {
  const { error } = await learn.rpc('attach_idea_topic_parent', { p_concept: conceptId, p_user: userId });
  if (error) warn('attaching the idea to its topic', error.message);
}

/** What saving one idea came to. */
export type SavedIdea =
  | { kind: 'new'; conceptId: string }
  /** The same idea as a concept already held, reworded; its card is not shown. */
  | { kind: 'duplicate'; conceptId: string; name: string }
  /** The concept could not be saved; the card still shows. */
  | { kind: 'unsaved' };

/**
 * Save each idea as a concept, in the order given, under the subject the
 * person chose that it belongs to (`chosenSubjectFor`), and attach each new
 * one to its frame topic. With no such subject every idea comes back unsaved.
 *
 * Every claim is embedded in one call. An idea whose claim sits within
 * `DUPLICATE_SIMILARITY` of a concept already held, or of an earlier idea in
 * this same list, is a copy and is not saved again.
 */
export async function saveIdeas(
  learn: LearnSupabaseClient,
  userId: string,
  /** `cardId` is the feed card the ideas were written for, which names the subject they belong to. */
  source: { article: string; section: string | null; cardId?: string | null },
  ideas: IdeaCard[],
  onSpend?: SpendSink,
): Promise<SavedIdea[]> {
  if (ideas.length === 0) return [];
  const unsaved = ideas.map((): SavedIdea => ({ kind: 'unsaved' }));

  const embedded = await embedTexts({
    texts: ideas.map((idea) => idea.takeaway),
    inputType: 'document',
    onSpend,
  });
  if (!embedded.ok) warn('embedding the claims', embedded.detail);

  let subjectId: string | null;
  try {
    subjectId = await chosenSubjectFor(learn, userId, source.cardId ?? null, source.article);
  } catch (error) {
    warn('finding the subject the ideas belong to', error);
    return unsaved;
  }
  if (!subjectId) return unsaved;

  const saved: SavedIdea[] = [];
  for (const [index, idea] of ideas.entries()) {
    const vector = embedded.ok ? vectorLiteral(embedded.vectors[index]!) : null;
    try {
      if (vector) {
        // Earlier ideas in this list are saved by now, so they are found here too.
        const [closest] = await nearest(learn, userId, vector, 1, DUPLICATE_SIMILARITY);
        if (closest) {
          saved.push({ kind: 'duplicate', conceptId: closest.concept_id, name: closest.name });
          continue;
        }
      }
      const { data, error } = await learn
        .from('concepts')
        .insert({
          user_id: userId,
          subject_id: subjectId,
          name: idea.name,
          claim: idea.takeaway,
          basis: ideaBasis(source.article, source.section),
          origin: 'feed',
          embedding: vector,
          embedding_model: vector && embedded.ok ? embedded.model : null,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'no row');
      const conceptId = (data as { id: string }).id;
      if (vector) await attachToTopic(learn, userId, conceptId);
      saved.push({ kind: 'new', conceptId });
    } catch (error) {
      warn(`saving the idea "${idea.name}"`, error);
      saved.push({ kind: 'unsaved' });
    }
  }
  return saved;
}

/**
 * Set the state of a card's idea from a swipe on it, through the person's own
 * session. A card with no idea, or a swipe that says nothing about the idea,
 * changes nothing.
 */
export async function settleIdeaFromSwipe(
  supabase: LearnSupabaseClient,
  userId: string,
  cardId: string,
  swipe: SwipeAction,
): Promise<void> {
  try {
    const { data: card } = await supabase.from('feed_cards').select('concept_id').eq('id', cardId).maybeSingle();
    const conceptId = (card as { concept_id: string | null } | null)?.concept_id;
    if (!conceptId) return;

    const { data: current, error: readError } = await supabase
      .from('concept_state')
      .select('established')
      .eq('concept_id', conceptId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const state = swipeState(swipe, (current as { established: StateBasis } | null) ?? null);
    if (!state) return;

    const { error } = await supabase.from('concept_state').upsert(
      {
        concept_id: conceptId,
        user_id: userId,
        state,
        established: 'declared',
        // The column is tied to the misconception state by a check, and a
        // swipe never writes that state.
        misconception: null,
        // Nothing was answered, so there is no tested date. The day it was
        // said is what a later re-check reads.
        tested_at: null,
        declared_at: new Date().toISOString(),
      },
      { onConflict: 'concept_id' },
    );
    if (error) throw new Error(error.message);
    await scheduleIdeas(supabase, userId, [conceptId], { basis: 'declared' });
  } catch (error) {
    warn('recording the swipe on the idea', error);
  }
}

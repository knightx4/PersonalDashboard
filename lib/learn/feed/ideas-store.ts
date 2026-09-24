import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
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
 * The hidden subject a feed idea from `article` is filed under, made the first
 * time. A track already named after the article is used as it is.
 */
async function subjectForArticle(learn: LearnSupabaseClient, userId: string, article: string): Promise<string> {
  const find = async (): Promise<string | null> => {
    const { data, error } = await learn
      .from('subjects')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', article)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { id: string } | null)?.id ?? null;
  };

  const found = await find();
  if (found) return found;

  const { data, error } = await learn
    .from('subjects')
    .insert({ user_id: userId, name: article, survey: true })
    .select('id')
    .single();
  if (error?.code === '23505') {
    // Another write made it first.
    const raced = await find();
    if (raced) return raced;
  }
  if (error || !data) throw new Error(error?.message ?? 'no row');
  return (data as { id: string }).id;
}

/** What saving one idea came to. */
export type SavedIdea =
  | { kind: 'new'; conceptId: string }
  /** The same idea as a concept already held, reworded; its card is not shown. */
  | { kind: 'duplicate'; conceptId: string; name: string }
  /** The concept could not be saved; the card still shows. */
  | { kind: 'unsaved' };

/**
 * Save each idea as a concept, in the order given.
 *
 * Every claim is embedded in one call. An idea whose claim sits within
 * `DUPLICATE_SIMILARITY` of a concept already held, or of an earlier idea in
 * this same list, is a copy and is not saved again.
 */
export async function saveIdeas(
  learn: LearnSupabaseClient,
  userId: string,
  source: { article: string; section: string | null },
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

  let subjectId: string;
  try {
    subjectId = await subjectForArticle(learn, userId, source.article);
  } catch (error) {
    warn('filing the ideas under their article', error);
    return unsaved;
  }

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
      saved.push({ kind: 'new', conceptId: (data as { id: string }).id });
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
  } catch (error) {
    warn('recording the swipe on the idea', error);
  }
}

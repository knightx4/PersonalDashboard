import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { cardTitle } from '@/lib/learn/feed/card';
import type { GoalCardSource } from './goal-idea';

/**
 * The rows a goal question is written from (plan #1383).
 *
 * Every read filters by `user_id` as well as by id, so these are safe under
 * the service role, as `surveySubjectForAim` is.
 */

/** Ids per `in` filter. */
const CHUNK = 100;

/** Goal cards read, newest first, before the ones already used are left out. */
const CARDS_READ = 50;

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

async function inChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  action: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < ids.length; from += CHUNK) {
    const { data, error } = await read(ids.slice(from, from + CHUNK));
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail(action, error);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/**
 * The goal's cards the person marked Got it or saved, newest first, each with
 * the text of the section it was cut from. A card whose section has no text is
 * left out, since there is nothing to quote.
 */
export async function loadGoalCards(
  supabase: LearnSupabaseClient,
  userId: string,
  aimId: string,
): Promise<GoalCardSource[]> {
  const { data, error } = await supabase
    .from('feed_cards')
    .select('id, item_id, segment_id, named_article')
    .eq('user_id', userId)
    .eq('aim_id', aimId)
    .eq('reason', 'goal')
    .or('status.in.(known,saved),saved_reading_id.not.is.null')
    .not('segment_id', 'is', null)
    .order('acted_at', { ascending: false, nullsFirst: false })
    .limit(CARDS_READ);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail("Reading the goal's cards", error);
  const cards = (data ?? []) as {
    id: string;
    item_id: string | null;
    segment_id: string;
    named_article: string | null;
  }[];
  if (cards.length === 0) return [];

  const itemIds = [...new Set(cards.flatMap((card) => (card.item_id ? [card.item_id] : [])))];
  const [items, segments] = await Promise.all([
    inChunks<{ id: string; title: string }>(
      itemIds,
      (chunk) => supabase.from('catalogue_items').select('id, title').in('id', chunk),
      'Reading the articles',
    ),
    inChunks<{ id: string; heading: string | null; text: string | null }>(
      cards.map((card) => card.segment_id),
      (chunk) => supabase.from('catalogue_segments').select('id, heading, text').in('id', chunk),
      'Reading the sections',
    ),
  ]);
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const sections = new Map(segments.map((segment) => [segment.id, segment]));

  return cards.flatMap((card) => {
    const section = sections.get(card.segment_id);
    const article = (card.item_id && titles.get(card.item_id)) || card.named_article;
    if (!section?.text?.trim() || !article) return [];
    return [{ cardId: card.id, title: cardTitle(article, section.heading), text: section.text }];
  });
}

/** One idea in a goal's survey subject, with what has been asked about it. */
export type GoalSubjectIdea = {
  conceptId: string;
  name: string;
  claim: string;
  basis: string | null;
  mastery: string[];
  /** Questions written about it, answered or not. */
  asked: number;
};

export type GoalSubjectState = {
  ideas: GoalSubjectIdea[];
  /** Questions on the goal answered right. */
  rightAnswers: number;
};

/** Whether an answered question was answered right, multiple choice or written. */
export function answeredRight(probe: {
  correct_index: number | null;
  chosen_index: number | null;
  dont_know: boolean | null;
  response_correct: boolean | null;
}): boolean {
  if (probe.dont_know) return false;
  if (probe.response_correct === true) return true;
  return probe.chosen_index !== null && probe.chosen_index === probe.correct_index;
}

/** The ideas in a goal's survey subject, oldest first, and its right answers. */
export async function loadGoalSubjectState(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<GoalSubjectState> {
  const { data, error } = await supabase
    .from('concepts')
    .select('id, name, claim, basis, mastery')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail("Reading the goal's ideas", error);
  const concepts = (data ?? []) as {
    id: string;
    name: string;
    claim: string;
    basis: string | null;
    mastery: string[] | null;
  }[];
  if (concepts.length === 0) return { ideas: [], rightAnswers: 0 };

  const probes = await inChunks<{
    concept_id: string;
    correct_index: number | null;
    chosen_index: number | null;
    dont_know: boolean | null;
    response_correct: boolean | null;
  }>(
    concepts.map((concept) => concept.id),
    (chunk) =>
      supabase
        .from('probes')
        .select('concept_id, correct_index, chosen_index, dont_know, response_correct')
        .eq('user_id', userId)
        .in('concept_id', chunk),
    "Reading the goal's questions",
  );

  const asked = new Map<string, number>();
  let rightAnswers = 0;
  for (const probe of probes) {
    asked.set(probe.concept_id, (asked.get(probe.concept_id) ?? 0) + 1);
    if (answeredRight(probe)) rightAnswers += 1;
  }
  return {
    ideas: concepts.map((concept) => ({
      conceptId: concept.id,
      name: concept.name,
      claim: concept.claim,
      basis: concept.basis,
      mastery: concept.mastery ?? [],
      asked: asked.get(concept.id) ?? 0,
    })),
    rightAnswers,
  };
}

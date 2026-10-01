import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { cardTitle } from '@/lib/learn/feed/card';
import type { GoalCardSource } from './goal-idea';

/**
 * The rows a Practice Flow question about the Level 3 goal is written from
 * and filed under (plan #1386).
 *
 * The claimed articles come from `learn.level3_untested_claims`, which reads
 * the caller's own evidence, so this runs through the person's session.
 * Everything else filters by `user_id` too.
 */

/** Ids per `in` filter. */
const CHUNK = 100;

/** Claimed articles read per question: the longest claimed first. */
const CLAIMS_READ = 50;

/** One claimed, untested Level 3 article. */
export type Level3Claim = { title: string; claimedAt: string | null };

/** One idea in the Level 3 goal's subject and the article it is about. */
export type Level3Idea = {
  conceptId: string;
  name: string;
  claim: string;
  basis: string | null;
  mastery: string[];
  /** The article's subject name, from the cross-listing. Null if it has none. */
  article: string | null;
  /** Questions written about it, answered or not. */
  asked: number;
  /** Questions about it still waiting to be answered. */
  waiting: number;
};

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

/** The viewer's claimed, untested Level 3 articles, the longest claimed first. */
export async function loadLevel3Claims(supabase: LearnSupabaseClient): Promise<Level3Claim[]> {
  const { data, error } = await supabase.rpc('level3_untested_claims', { p_limit: CLAIMS_READ });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading your claimed Level 3 articles', error);
  return ((data ?? []) as { title: string; claimed_at: string | null }[]).map((row) => ({
    title: row.title,
    claimedAt: row.claimed_at,
  }));
}

/**
 * The article's cards the person marked Got it or saved, newest first, each
 * with the text of the section it was cut from. The same cards that make the
 * article claimed in `learn.article_evidence`, matched to the article by the
 * catalogue item's title.
 */
export async function loadArticleCards(
  supabase: LearnSupabaseClient,
  userId: string,
  article: string,
): Promise<GoalCardSource[]> {
  const { data: items, error: itemError } = await supabase
    .from('catalogue_items')
    .select('id, title')
    .ilike('title', article);
  assertSchemaExposed(itemError, LEARN_SCHEMA);
  if (itemError) throw fail('Reading the article', itemError);
  const titles = new Map(
    ((items ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]),
  );
  if (titles.size === 0) return [];

  const { data, error } = await supabase
    .from('feed_cards')
    .select('id, item_id, segment_id')
    .eq('user_id', userId)
    .in('item_id', [...titles.keys()])
    .or('status.eq.known,saved_reading_id.not.is.null')
    .not('segment_id', 'is', null)
    .order('acted_at', { ascending: false, nullsFirst: false });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail("Reading the article's cards", error);
  const cards = (data ?? []) as { id: string; item_id: string; segment_id: string }[];
  if (cards.length === 0) return [];

  const segments = await inChunks<{ id: string; heading: string | null; text: string | null }>(
    [...new Set(cards.map((card) => card.segment_id))],
    (chunk) => supabase.from('catalogue_segments').select('id, heading, text').in('id', chunk),
    'Reading the sections',
  );
  const sections = new Map(segments.map((segment) => [segment.id, segment]));

  const seen = new Set<string>();
  return cards.flatMap((card) => {
    const section = sections.get(card.segment_id);
    // Two cards from one section (a Got it and a save) are one source.
    if (!section?.text?.trim() || seen.has(card.segment_id)) return [];
    seen.add(card.segment_id);
    const title = cardTitle(titles.get(card.item_id) ?? article, section.heading);
    return [{ cardId: card.id, title, text: section.text }];
  });
}

/** The ideas in the Level 3 goal's subject, oldest first, with the article each is about. */
export async function loadLevel3Ideas(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<Level3Idea[]> {
  const { data, error } = await supabase
    .from('concepts')
    .select('id, name, claim, basis, mastery')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the Level 3 ideas', error);
  const concepts = (data ?? []) as {
    id: string;
    name: string;
    claim: string;
    basis: string | null;
    mastery: string[] | null;
  }[];
  if (concepts.length === 0) return [];
  const ids = concepts.map((concept) => concept.id);

  const [listings, probes] = await Promise.all([
    inChunks<{ concept_id: string; subject_id: string }>(
      ids,
      (chunk) =>
        supabase
          .from('concept_subjects')
          .select('concept_id, subject_id')
          .eq('user_id', userId)
          .in('concept_id', chunk),
      'Reading the articles the ideas are about',
    ),
    inChunks<{ concept_id: string; answered_at: string | null; discarded_at: string | null }>(
      ids,
      (chunk) =>
        supabase
          .from('probes')
          .select('concept_id, answered_at, discarded_at')
          .eq('user_id', userId)
          .in('concept_id', chunk),
      'Reading the Level 3 questions',
    ),
  ]);
  const subjects = await inChunks<{ id: string; name: string }>(
    [...new Set(listings.map((row) => row.subject_id))],
    (chunk) => supabase.from('subjects').select('id, name').eq('user_id', userId).in('id', chunk),
    'Reading the article subjects',
  );
  const names = new Map(subjects.map((row) => [row.id, row.name]));
  const articleOf = new Map(
    listings.map((row) => [row.concept_id, names.get(row.subject_id) ?? null]),
  );

  const asked = new Map<string, number>();
  const waiting = new Map<string, number>();
  for (const probe of probes) {
    asked.set(probe.concept_id, (asked.get(probe.concept_id) ?? 0) + 1);
    if (!probe.answered_at && !probe.discarded_at) {
      waiting.set(probe.concept_id, (waiting.get(probe.concept_id) ?? 0) + 1);
    }
  }
  return concepts.map((concept) => ({
    conceptId: concept.id,
    name: concept.name,
    claim: concept.claim,
    basis: concept.basis,
    mastery: concept.mastery ?? [],
    article: articleOf.get(concept.id) ?? null,
    asked: asked.get(concept.id) ?? 0,
    waiting: waiting.get(concept.id) ?? 0,
  }));
}

/**
 * The subject named after the article, which `learn.article_evidence` counts
 * a right answer under: a track or hidden subject already named after it, or
 * a new hidden one. As `subjectForArticle` in the feed makes them, so Learn
 * now's ideas from the article and these questions share it.
 */
export async function subjectForArticle(
  supabase: LearnSupabaseClient,
  userId: string,
  article: string,
): Promise<string> {
  const find = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from('subjects')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', article)
      .maybeSingle();
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail("Looking up the article's subject", error);
    return (data as { id: string } | null)?.id ?? null;
  };

  const found = await find();
  if (found) return found;

  const { data, error } = await supabase
    .from('subjects')
    .insert({ user_id: userId, name: article, survey: true })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error?.code === '23505') {
    // Another write made it first.
    const raced = await find();
    if (raced) return raced;
  }
  if (error || !data) throw fail("Making the article's subject", error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

/** File an idea under the article's subject as well as the goal's. */
export async function crossList(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  subjectId: string,
  article: string,
): Promise<void> {
  const { error } = await supabase.from('concept_subjects').insert({
    user_id: userId,
    concept_id: conceptId,
    subject_id: subjectId,
    basis: `Asked about in Practice Flow as "${article}", a Level 3 article you claimed.`,
  });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error && error.code !== '23505') throw fail('Filing the idea under its article', error);
}

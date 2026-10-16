import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  AGREE_SIMILARITY,
  TOPIC_SOURCE_KINDS,
  TOPICS_PER_SOURCE,
  buildTopicNames,
  decideTopicUnlocks,
  findTopicNames,
  staleTopicLinkIds,
  topicSource,
  type TopicArticle,
  type TopicHit,
  type TopicSource,
  type TopicSourceRow,
} from './topics';

/**
 * Unlocking topics from your notes, courses, work and ideas (plan #2016.3),
 * as a stage of the daily run after the links to ideas. The rules are
 * ./topics; this reads and writes.
 *
 * 1. Every topic's names are read from learn.area_check_articles.
 * 2. Each source's text is read through learn.topic_unlock_sources (learn
 *    0129), the notes a page at a time, and searched for those names.
 * 3. learn.topic_similarity_matches gives each source's nearest topics, and
 *    learn.topic_pair_similarities how close each named pair is, both from
 *    stored vectors.
 * 4. The links are written to learn.evidence_links as target_kind 'topic',
 *    and the topic links this run did not find are removed: a link to a
 *    topic has no row to go with, so this is what clears it.
 *
 * A course whose topics a call has named is left out: it marks those topics
 * as a band instead (plan #2172.4.1), and its band links are never cleared
 * here.
 *
 * No model is called. Runs under the service role, so every query names the
 * person.
 */

const ARTICLE_PAGE = 1000;
const NOTE_PAGE = 200;
const PAIRS_PER_CALL = 2000;
const WRITE_CHUNK = 500;
const DELETE_CHUNK = 200;
const ON_CONFLICT = 'user_id,target_kind,target_id,source_kind,source_id';

export type RefreshTopicUnlocksResult = {
  /** Sources read, of every kind. */
  sources: number;
  /** Topics with at least one link: the ones unlocked. */
  topics: number;
  /** Links written, those held for want of confirmation included. */
  links: number;
  removed: number;
};

type Rpc = <T>(
  name: string,
  args: Record<string, unknown>,
) => {
  range: (from: number, to: number) => PromiseLike<{ data: T | null; error: { message: string } | null }>;
} & PromiseLike<{ data: T | null; error: { message: string } | null }>;

async function loadArticles(learn: LearnSupabaseClient): Promise<TopicArticle[]> {
  const out: TopicArticle[] = [];
  for (let from = 0; ; from += ARTICLE_PAGE) {
    const { data, error } = await learn
      .from('area_check_articles')
      .select('id, title, aliases')
      .order('id')
      .range(from, from + ARTICLE_PAGE - 1);
    if (error) throw new Error(`Reading the topics failed: ${error.message}`);
    const rows = (data ?? []) as TopicArticle[];
    out.push(...rows);
    if (rows.length < ARTICLE_PAGE) return out;
  }
}

/** The courses whose topics a call has named (learn.course_topics, learn 0157). */
async function loadNamedCourses(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await learn.from('course_topics').select('course_id').eq('user_id', userId);
  if (error) throw new Error(`Reading the named courses failed: ${error.message}`);
  return new Set(((data ?? []) as { course_id: string }[]).map((row) => row.course_id));
}

export async function refreshTopicUnlocks(
  learn: LearnSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<RefreshTopicUnlocksResult> {
  const rpc = learn.rpc.bind(learn) as unknown as Rpc;
  const index = buildTopicNames(await loadArticles(learn));
  const nowYear = now.getUTCFullYear();
  // A course whose topics a call named marks them as a band (./course-band-store),
  // so its name and vector matches are left out here (plan #2172.4.1).
  const namedCourses = await loadNamedCourses(learn, userId);

  // 1 and 2. Names in each source's text.
  const sources = new Map<string, TopicSource>();
  const hits: TopicHit[] = [];
  for (const kind of TOPIC_SOURCE_KINDS) {
    const paged = kind === 'note';
    for (let from = 0; ; from += NOTE_PAGE) {
      const call = rpc<TopicSourceRow[]>('topic_unlock_sources', { p_user_id: userId, p_kind: kind });
      const { data, error } = paged ? await call.range(from, from + NOTE_PAGE - 1) : await call;
      if (error) throw new Error(`Reading ${kind} sources for topics failed: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        const source = topicSource(kind, row, nowYear);
        if (!source || (kind === 'course' && namedCourses.has(source.id))) continue;
        sources.set(`${kind} ${source.id}`, source);
        for (const [topicId, name] of findTopicNames(index, source.text)) {
          hits.push({ topicId, source, name, similarity: null });
        }
        // The text is not needed past here; a vault's notes are megabytes.
        source.text = '';
      }
      if (!paged || rows.length < NOTE_PAGE) break;
    }
  }

  // 3a. How close each named pair is.
  const named = new Map<string, TopicHit>();
  for (const hit of hits) named.set(`${hit.source.kind} ${hit.source.id} ${hit.topicId}`, hit);
  const pairs = [...named.values()].map((h) => ({ k: h.source.kind, s: h.source.id, t: h.topicId }));
  for (let start = 0; start < pairs.length; start += PAIRS_PER_CALL) {
    const { data, error } = await rpc<{ source_kind: string; source_id: string; topic_id: string; similarity: number }[]>(
      'topic_pair_similarities',
      { p_user_id: userId, p_pairs: pairs.slice(start, start + PAIRS_PER_CALL) },
    );
    if (error) throw new Error(`Comparing named topics failed: ${error.message}`);
    for (const row of data ?? []) {
      const hit = named.get(`${row.source_kind} ${row.source_id} ${row.topic_id}`);
      if (hit) hit.similarity = row.similarity;
    }
  }

  // 3b. Each source's nearest topics.
  const { data: near, error: nearError } = await rpc<
    { source_kind: string; source_id: string; topic_id: string; similarity: number }[]
  >('topic_similarity_matches', {
    p_user_id: userId,
    p_per_source: TOPICS_PER_SOURCE,
    p_min_similarity: AGREE_SIMILARITY,
  });
  if (nearError) throw new Error(`Finding the topics nearest your sources failed: ${nearError.message}`);
  for (const row of near ?? []) {
    const source = sources.get(`${row.source_kind} ${row.source_id}`);
    if (source) hits.push({ topicId: row.topic_id, source, similarity: row.similarity });
  }

  // 4. Write, then clear what was not found.
  const rows = decideTopicUnlocks(hits).map((row) => ({ ...row, user_id: userId }));
  for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
    const { error } = await learn
      .from('evidence_links')
      .upsert(rows.slice(start, start + WRITE_CHUNK), { onConflict: ON_CONFLICT });
    if (error) throw new Error(`Writing topic unlocks failed: ${error.message}`);
  }

  const existing: { id: string; target_id: string; source_kind: string; source_id: string; band_high: number | null }[] = [];
  for (let from = 0; ; from += ARTICLE_PAGE) {
    const { data, error } = await learn
      .from('evidence_links')
      .select('id, target_id, source_kind, source_id, band_high')
      .eq('user_id', userId)
      .eq('target_kind', 'topic')
      .order('id')
      .range(from, from + ARTICLE_PAGE - 1);
    if (error) throw new Error(`Reading topic unlocks failed: ${error.message}`);
    const page = (data ?? []) as typeof existing;
    existing.push(...page);
    if (page.length < ARTICLE_PAGE) break;
  }
  // A course's band links are the band stage's to keep or clear.
  const stale = staleTopicLinkIds(
    existing.filter((row) => row.band_high === null),
    rows,
  );
  for (let start = 0; start < stale.length; start += DELETE_CHUNK) {
    const { error } = await learn
      .from('evidence_links')
      .delete()
      .eq('user_id', userId)
      .in('id', stale.slice(start, start + DELETE_CHUNK));
    if (error) throw new Error(`Clearing old topic unlocks failed: ${error.message}`);
  }

  return {
    sources: sources.size,
    topics: new Set(rows.filter((row) => !row.held_reason).map((row) => row.target_id)).size,
    links: rows.length,
    removed: stale.length,
  };
}

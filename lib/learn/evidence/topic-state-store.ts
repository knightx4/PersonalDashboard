import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { readCells } from '@/lib/learn/levels/model';
import { loadTopicMap } from '@/lib/learn/levels/store';
import type { StrengthInput } from '@/lib/learn/strength';
import type { EvidenceKind } from './kinds';
import {
  topicStates,
  type TopicIdea,
  type TopicLevels,
  type TopicLink,
  type TopicNode,
  type TopicState,
} from './topic-state';

/**
 * Reading what topicStates needs and returning every topic's state on a day
 * (plan #2016.4). The rules are ./topic-state. Under the service role every
 * query names the person; with the session client RLS does and `userId` can
 * be left out.
 */

const PAGE = 1000;
const IN_CHUNK = 200;

async function pages<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadTopicStates(
  learn: LearnSupabaseClient,
  options: { userId?: string; on?: Date } = {},
): Promise<Map<string, TopicState>> {
  const { userId, on = new Date() } = options;

  const articles = await pages<{ id: string; level: number; parent_id: string | null }>(
    (a, b) =>
      learn.from('area_check_articles').select('id, level, parent_id').in('level', [3, 4]).order('id').range(a, b),
    'the topics',
  );
  const topics: TopicNode[] = articles.map((r) => ({
    id: r.id,
    level: r.level === 3 ? 3 : 4,
    parentId: r.parent_id,
  }));

  const parents = await pages<{ concept_id: string; topic_id: string }>((a, b) => {
    let q = learn.from('idea_topic_parents').select('concept_id, topic_id').order('concept_id').range(a, b);
    if (userId) q = q.eq('user_id', userId);
    return q;
  }, 'where ideas sit');

  const stateByIdea = new Map<string, StrengthInput>();
  const ids = parents.map((p) => p.concept_id);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    let q = learn
      .from('concept_state')
      .select('concept_id, state, established, tested_at, declared_at, review_interval_days')
      .in('concept_id', ids.slice(i, i + IN_CHUNK));
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) throw new Error(`Reading idea states failed: ${error.message}`);
    for (const row of (data ?? []) as (StrengthInput & { concept_id: string })[]) stateByIdea.set(row.concept_id, row);
  }
  const ideas: TopicIdea[] = parents.map((p) => ({
    id: p.concept_id,
    topicId: p.topic_id,
    state: stateByIdea.get(p.concept_id) ?? null,
  }));

  const rows = await pages<{
    target_id: string;
    kind: EvidenceKind;
    ceiling: number;
    similarity: number;
    found_at: string;
    matched_by: 'name' | 'similarity' | null;
  }>((a, b) => {
    let q = learn
      .from('evidence_links')
      .select('target_id, kind, ceiling, similarity, found_at, matched_by')
      .eq('target_kind', 'topic')
      .neq('kind', 'mention')
      .order('id')
      .range(a, b);
    if (userId) q = q.eq('user_id', userId);
    return q;
  }, 'the topic links');
  const linksByTopic = new Map<string, TopicLink[]>();
  for (const r of rows) {
    const list = linksByTopic.get(r.target_id) ?? [];
    list.push({ kind: r.kind, ceiling: r.ceiling, similarity: r.similarity, foundAt: r.found_at, matchedBy: r.matched_by });
    linksByTopic.set(r.target_id, list);
  }

  return topicStates(topics, ideas, linksByTopic, on, await loadTopicLevels(learn, userId));
}

/**
 * The topics on your map that refine a frame topic, and the levels model to
 * read them by, for breadth and depth (plan #2172.2). Nothing is read past
 * the first query when no topic refines one.
 */
export async function loadTopicLevels(learn: LearnSupabaseClient, userId?: string): Promise<TopicLevels | undefined> {
  let q = learn.from('topics').select('id, refines_article_id').not('refines_article_id', 'is', null);
  if (userId) q = q.or(`user_id.is.null,user_id.eq.${userId}`);
  const { data, error } = await q;
  if (error) throw new Error(`Reading which topics refine the frame failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; refines_article_id: string }[];
  if (rows.length === 0) return undefined;
  const refining = new Map<string, string[]>();
  for (const row of rows) {
    const list = refining.get(row.refines_article_id) ?? [];
    list.push(row.id);
    refining.set(row.refines_article_id, list);
  }
  const map = await loadTopicMap(learn, { userId });
  return { map, readings: readCells(map), refining };
}

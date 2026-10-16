import 'server-only';

import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { TopicRows } from './topics';

/**
 * Reading what Idea Space's topic frame is built from (plan #2016.5). Every
 * Level 3 topic is read, but of the ten thousand Level 4 topics only those
 * an idea or an evidence link touches: the rest are hidden, so they are
 * counted and not fetched. Under the service role `userId` names the person
 * on every read of theirs; through the session RLS does.
 */

/** Ids per `in` filter, so a request's address stays short. */
const IN_CHUNK = 200;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function loadTopicRows(learn: LearnSupabaseClient, userId?: string): Promise<TopicRows> {
  const [level3, parents, links, total] = await Promise.all([
    readAll<TopicRows['level3'][number]>(
      (from, to) =>
        learn
          .from('area_check_articles')
          .select('id, title, field_id')
          .eq('level', 3)
          .order('id')
          .range(from, to) as unknown as Page<TopicRows['level3'][number]>,
    ),
    readAll<TopicRows['parents'][number]>((from, to) => {
      let q = learn.from('idea_topic_parents').select('concept_id, topic_id');
      if (userId) q = q.eq('user_id', userId);
      return q.order('concept_id').range(from, to) as unknown as Page<TopicRows['parents'][number]>;
    }),
    readAll<TopicRows['links'][number]>((from, to) => {
      let q = learn
        .from('evidence_links')
        .select('target_id, kind, ceiling, similarity, found_at, matched_by')
        .eq('target_kind', 'topic')
        .neq('kind', 'mention');
      if (userId) q = q.eq('user_id', userId);
      return q.order('id').range(from, to) as unknown as Page<TopicRows['links'][number]>;
    }),
    learn.from('area_check_articles').select('id', { count: 'exact', head: true }).eq('level', 4),
  ]);
  if (total.error) throw new Error(`Counting the Level 4 topics failed: ${total.error.message}`);

  const level3Ids = new Set(level3.map((r) => r.id));
  const touched = [
    ...new Set([...parents.map((p) => p.topic_id), ...links.map((l) => l.target_id)].filter((id) => !level3Ids.has(id))),
  ].sort();
  const level4: TopicRows['level4'] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < touched.length; i += IN_CHUNK) chunks.push(touched.slice(i, i + IN_CHUNK));
  const reads = await Promise.all(
    chunks.map((ids) => learn.from('area_check_articles').select('id, title, parent_id').eq('level', 4).in('id', ids)),
  );
  for (const { data, error } of reads) {
    if (error) throw new Error(`Reading the Level 4 topics failed: ${error.message}`);
    level4.push(...((data ?? []) as TopicRows['level4']));
  }

  return { level3, level4, level4Total: total.count ?? level4.length, parents, links };
}

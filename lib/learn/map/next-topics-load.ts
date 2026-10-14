import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { NEAREST_PER_LIT, rankNextTopics, type NextTopic, type NextTopicRow, type RankOptions } from './next-topics';

/**
 * Reading the next topics beside what you know (plan #2016.6). The caller
 * says which topics are lit, from the topic frame on Idea Space or from
 * `loadTopicStates` in the Learn now draw; the vector reads are
 * learn.next_topic_candidates and the rule is ./next-topics.
 *
 * `userId` names whose goals rank the list. Through the session RLS keeps it
 * to the person's own; under the service role it is what keeps it to them.
 */
export async function loadNextTopics(
  learn: LearnSupabaseClient,
  userId: string,
  litIds: readonly string[],
  options: RankOptions = {},
): Promise<NextTopic[]> {
  if (litIds.length === 0) return [];
  const { data, error } = await learn.rpc('next_topic_candidates', {
    p_user_id: userId,
    p_lit: [...litIds],
    p_per: NEAREST_PER_LIT,
  });
  if (error) throw new Error(`Reading the topics beside what you know failed: ${error.message}`);
  return rankNextTopics((data ?? []) as NextTopicRow[], options);
}

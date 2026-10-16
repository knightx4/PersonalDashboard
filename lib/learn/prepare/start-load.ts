import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * The topic a finished preparation says to start with, as it stands now
 * (plan #2276.6): its name, whether it has been approved, and its level 1,
 * which Practice Flow asks about by id. Read again on every visit, since the
 * topic is drafted for approval and approved after the run has ended.
 */
export type StartTopicNow = {
  id: string;
  name: string;
  approved: boolean;
  /** The topic's level 1 cell, or null when it has none. */
  cellId: string | null;
};

export async function loadStartTopic(
  learn: LearnSupabaseClient,
  userId: string,
  topicId: string,
): Promise<StartTopicNow | null> {
  const [topicRead, cellRead] = await Promise.all([
    learn.from('topics').select('id, name, status').eq('user_id', userId).eq('id', topicId).maybeSingle(),
    learn.from('topic_cells').select('id').eq('topic_id', topicId).eq('level', 1).limit(1).maybeSingle(),
  ]);
  if (topicRead.error) throw new Error(`Reading the first topic failed: ${topicRead.error.message}`);
  const topic = topicRead.data as { id: string; name: string; status: string } | null;
  if (!topic) return null;
  return {
    id: topic.id,
    name: topic.name,
    approved: topic.status === 'approved',
    cellId: (cellRead.data as { id: string } | null)?.id ?? null,
  };
}

import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { NEWS_TOPICS, readTopic, type NewsTopic } from '@/lib/news/issues/topics';

/**
 * The topics hidden from Quick read with Fewer like this (plan #861), in
 * NEWS_TOPICS order.
 *
 * A stored name that is no longer on the list reads as nothing and hides
 * nothing, the way readTopic treats a story's stored topic. The rows are the
 * session's own by the table's policy, so nothing here filters by user.
 */
export async function loadHiddenTopics(client: NewsSupabaseClient): Promise<NewsTopic[]> {
  const { data, error } = await client.from('hidden_topics').select('topic');
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your hidden topics failed (${error.message})`);
  const found = new Set(((data ?? []) as { topic: string }[]).map((row) => readTopic(row.topic)));
  return NEWS_TOPICS.filter((topic) => found.has(topic));
}

/**
 * Hide a topic from Quick read. Hiding one already hidden keeps its first
 * row. `userId` is the session's, written because the policy checks it.
 */
export async function hideTopic(
  client: NewsSupabaseClient,
  { userId, topic }: { userId: string; topic: NewsTopic },
): Promise<void> {
  const { error } = await client
    .from('hidden_topics')
    .upsert({ user_id: userId, topic }, { onConflict: 'user_id,topic', ignoreDuplicates: true });
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: hiding ${topic} failed (${error.message})`);
}

/** Bring a hidden topic back into Quick read. */
export async function showTopic(
  client: NewsSupabaseClient,
  { userId, topic }: { userId: string; topic: NewsTopic },
): Promise<void> {
  const { error } = await client
    .from('hidden_topics')
    .delete()
    .eq('user_id', userId)
    .eq('topic', topic);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: bringing back ${topic} failed (${error.message})`);
}

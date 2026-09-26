import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { StoryConversation } from './discussed';

/**
 * How many story discussions the Saved tab reads. Each is three rounds at
 * most and started by hand, so this is a cap on one page, not on what is kept.
 */
const DISCUSSION_PAGE = 1000;

/**
 * Every news story conversation the person has, as its ref and the headline
 * it began with (plan #1061). Only the conversation rows are read, not their
 * turns: the Saved tab needs to know a story was discussed, and the sheet reads
 * the exchange when it opens. A conversation row is only written with its
 * first turn (appendTurns), so each one read here has something in it.
 */
export async function loadStoryConversations(
  core: CoreSupabaseClient,
): Promise<StoryConversation[]> {
  const { data, error } = await core
    .from('conversations')
    .select('subject_ref, title')
    .eq('subject_kind', 'news_story')
    .limit(DISCUSSION_PAGE);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading your story discussions failed: ${error.message}`);
  return ((data ?? []) as { subject_ref: string; title: string | null }[]).map((row) => ({
    ref: row.subject_ref,
    title: row.title,
  }));
}

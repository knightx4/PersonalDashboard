import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { STORY_TABLE } from '@/lib/news/quick/discuss';
import { savedStoryIdOf } from './discussed';

/**
 * How many story discussions the Saved tab reads. Each is three rounds at
 * most and started by hand, so this is a cap on one page, not on what is kept.
 */
const DISCUSSION_PAGE = 1000;

/**
 * The saved stories the person has discussed with Dash (plan #1061): the ids
 * named by row threads under news.saved_stories (plan #1468). Only the
 * conversation rows are read, not their turns: the Saved tab needs to know a
 * story was discussed, and the sheet reads the exchange when it opens. A
 * conversation row is only written with its first turn (appendTurns), so each
 * one read here has something in it.
 */
export async function loadDiscussedStoryIds(core: CoreSupabaseClient): Promise<Set<string>> {
  const { data, error } = await core
    .from('conversations')
    .select('subject_ref')
    .eq('subject_kind', 'row')
    .like('subject_ref', `${STORY_TABLE}:%`)
    .limit(DISCUSSION_PAGE);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading your story discussions failed: ${error.message}`);
  const ids = new Set<string>();
  for (const row of (data ?? []) as { subject_ref: string }[]) {
    const id = savedStoryIdOf(row.subject_ref);
    if (id) ids.add(id);
  }
  return ids;
}

/** The raw stories array of each of the given newsletters, by issue id. */
export async function loadIssueStories(
  news: NewsSupabaseClient,
  issueIds: readonly string[],
): Promise<Map<string, unknown[]>> {
  const out = new Map<string, unknown[]>();
  const wanted = [...new Set(issueIds)];
  if (wanted.length === 0) return out;
  const { data, error } = await news.from('issues').select('id, stories').in('id', wanted);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading the newsletters failed (${error.message})`);
  for (const row of (data ?? []) as { id: string; stories: unknown }[]) {
    out.set(row.id, Array.isArray(row.stories) ? row.stories : []);
  }
  return out;
}

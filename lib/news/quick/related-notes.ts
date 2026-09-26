import 'server-only';

import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  relatedNotesForStored,
  type RelatedNoteLink,
  type StoredVector,
} from '@/lib/vault/notes/related';

/**
 * Your notes nearest each story on a Quick read page (plan #1113, under #1110).
 *
 * A story's vector is already stored: grouping embedded its headline and
 * summary into news.story_groups when the newsletter arrived
 * (lib/news/issues/groups.ts), the same model and input type as the notes. So
 * showing related notes costs one read of those vectors and one
 * obsidian.nearest_notes call per story, and no embedding call.
 *
 * A story with no row (its newsletter could not be embedded) gets no notes.
 * Keyed `issueId:storyIndex`, the key Quick read already joins groups by.
 * Never throws: a failed read shows no notes rather than failing the page.
 */

export type StoryRef = { issueId: string; storyIndex: number };

export function storyKey({ issueId, storyIndex }: StoryRef): string {
  return `${issueId}:${storyIndex}`;
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function relatedNotesForStories(
  news: NewsSupabaseClient,
  vault: VaultSupabaseClient,
  userId: string,
  stories: readonly StoryRef[],
): Promise<Map<string, RelatedNoteLink[]>> {
  const wanted = new Map<string, StoryRef>();
  for (const story of stories) {
    // Both halves go into a PostgREST filter string, so each is checked first.
    if (UUID.test(story.issueId) && Number.isInteger(story.storyIndex)) {
      wanted.set(storyKey(story), story);
    }
  }
  if (wanted.size === 0) return new Map();

  try {
    // Only the rows asked for: a whole newsletter's vectors are twenty
    // kilobytes a story as text, and a page names a handful of stories.
    const filter = [...wanted.values()]
      .map((s) => `and(issue_id.eq.${s.issueId},story_index.eq.${s.storyIndex})`)
      .join(',');
    const { data, error } = await news
      .from('story_groups')
      .select('issue_id, story_index, embedding, embedding_model')
      .eq('user_id', userId)
      .or(filter);
    if (error) throw new Error(error.message);

    const stored: StoredVector[] = (
      (data ?? []) as {
        issue_id: string;
        story_index: number;
        embedding: unknown;
        embedding_model: string | null;
      }[]
    ).map((row) => ({
      key: storyKey({ issueId: row.issue_id, storyIndex: row.story_index }),
      embedding: row.embedding,
      model: row.embedding_model,
    }));
    return await relatedNotesForStored(vault, userId, stored);
  } catch (error) {
    console.error('[news related notes]', error instanceof Error ? error.message : error);
    return new Map();
  }
}

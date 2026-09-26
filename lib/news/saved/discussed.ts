import { parseStoryRef } from '@/lib/news/quick/discuss';

/**
 * Which saved stories have been discussed with Dash (plan #1061).
 *
 * The two tables name a story differently. A saved story is its issue and its
 * headline (news.saved_stories); a discussion is its issue and its index in the
 * issue's stories array (core.conversations.subject_ref, from storyRef). The
 * conversation keeps the headline it began with as its title, so a saved story
 * and a discussion are the same story when the issue matches and the title is
 * the saved headline. Matching on the title rather than on the index read from
 * the issue today means a re-summarised newsletter, which can move a story to
 * another index, still finds the discussion its headline began.
 *
 * This file needs no database, so it is tested on its own; the read is in
 * discussed-store.ts.
 */

/** A news_story conversation as the Saved tab needs it. */
export type StoryConversation = { ref: string; title: string | null };

/**
 * The story index each discussed saved story's conversation names, by saved
 * story id. Stories whose newsletter is gone (issueId null) have nothing to
 * match on and are left out, as are stories nobody discussed. When two
 * conversations in one issue carry the same headline, the lower index wins.
 */
export function discussedIndexes(
  saved: readonly { id: string; issueId: string | null; headline: string }[],
  conversations: readonly StoryConversation[],
): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const conversation of conversations) {
    const parsed = parseStoryRef(conversation.ref);
    const title = conversation.title?.trim();
    if (!parsed || !title) continue;
    const key = `${parsed.issueId}\n${title}`;
    const known = byKey.get(key);
    if (known === undefined || parsed.storyIndex < known) byKey.set(key, parsed.storyIndex);
  }

  const out = new Map<string, number>();
  for (const story of saved) {
    if (!story.issueId) continue;
    const index = byKey.get(`${story.issueId}\n${story.headline.trim()}`);
    if (index !== undefined) out.set(story.id, index);
  }
  return out;
}

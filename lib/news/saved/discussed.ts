import { readStories } from '@/lib/news/issues/stories';
import { STORY_TABLE } from '@/lib/news/quick/discuss';

/**
 * Which saved stories have been discussed with Dash (plan #1061), and where
 * each sits in its newsletter so the Discussed button can open the sheet.
 *
 * A discussion is the row thread under the saved story,
 * `news.saved_stories:<id>` (lib/news/quick/discuss.ts, plan #1468), so which
 * stories were discussed is read straight off the threads' refs. The sheet
 * still works from the newsletter, by issue and index, so each discussed
 * story is found in its issue's stories array by headline. Matching on the
 * headline rather than a stored index means a re-summarised newsletter, which
 * can move a story to another index, still finds it.
 *
 * This file needs no database, so it is tested on its own; the reads are in
 * discussed-store.ts.
 */

/** The saved story id a thread's ref names, or null when it is not a story's thread. */
export function savedStoryIdOf(ref: string): string | null {
  const prefix = `${STORY_TABLE}:`;
  if (!ref.startsWith(prefix)) return null;
  const id = ref.slice(prefix.length).trim();
  return id || null;
}

/**
 * The story index of each discussed saved story, by saved story id. Indexed
 * in the raw stories array, as reactions.ts and the discuss actions are.
 * Stories whose newsletter is gone (issueId null, or not in `issueStories`),
 * stories nobody discussed, and stories no longer in their newsletter are left
 * out. When two stories in one issue carry the headline, the first wins.
 */
export function discussedIndexes(
  saved: readonly { id: string; issueId: string | null; headline: string }[],
  discussed: ReadonlySet<string>,
  issueStories: ReadonlyMap<string, readonly unknown[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const story of saved) {
    if (!story.issueId || !discussed.has(story.id)) continue;
    const entries = issueStories.get(story.issueId) ?? [];
    const headline = story.headline.trim();
    const index = entries.findIndex((entry) => readStories([entry])[0]?.headline.trim() === headline);
    if (index >= 0) out.set(story.id, index);
  }
  return out;
}

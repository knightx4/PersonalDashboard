import 'server-only';

import { createNewsClient } from '@/lib/news/auth/server';
import { loadStoryOrigins, type StoryOrigin } from '@/lib/news/saved/stories';

/**
 * Where the readings sent from News came from, by saved story id (plan #1368).
 *
 * A second client because the story lives in the news schema, which a Learn
 * query cannot embed. A failure reading it costs the "From" line and nothing
 * else: the reading still opens its article, so the page draws without it.
 */
export async function loadReadingOrigins(
  storyIds: readonly string[],
): Promise<Map<string, StoryOrigin>> {
  if (storyIds.length === 0) return new Map();
  try {
    return await loadStoryOrigins(await createNewsClient(), storyIds);
  } catch {
    return new Map();
  }
}

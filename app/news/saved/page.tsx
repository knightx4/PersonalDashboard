import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { formatArrival } from '@/lib/news/issues/list';
import { discussedIndexes } from '@/lib/news/saved/discussed';
import { loadStoryConversations } from '@/lib/news/saved/discussed-store';
import { loadSavedStories } from '@/lib/news/saved/stories';
import { SavedView } from './saved-view';

export const metadata = { title: 'Saved' };
export const dynamic = 'force-dynamic';

/**
 * The stories saved from Quick read and the issue page (plan #870), newest
 * saved first. #867 settled on one list, so there are no collections to pick
 * between. Each story is the copy taken when it was saved, so it stays whole
 * after its newsletter is deleted; only the link to the newsletter goes.
 *
 * A story discussed with Dash is saved when the discussion starts, and is
 * marked Discussed here with the exchange a tap away (plan #1061). The
 * conversations are read alongside the stories and matched by issue and
 * headline (lib/news/saved/discussed.ts); a failed read of them leaves the
 * list without the marks rather than failing the page.
 */
export default async function SavedPage() {
  const user = await requireUser();
  const [client, core] = await Promise.all([createNewsClient(), createCoreClient()]);
  const [settings, stories, conversations] = await Promise.all([
    loadAccountSettings(user.id),
    loadSavedStories(client),
    loadStoryConversations(core).catch(() => []),
  ]);
  const discussed = discussedIndexes(stories, conversations);

  return (
    <SavedView
      stories={stories.map((story) => ({
        ...story,
        arrived: formatArrival(story.receivedAt, settings.timezone),
        discussedIndex: discussed.get(story.id) ?? null,
      }))}
    />
  );
}

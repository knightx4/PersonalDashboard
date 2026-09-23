import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { formatArrival } from '@/lib/news/issues/list';
import { loadSavedStories } from '@/lib/news/saved/stories';
import { SavedView } from './saved-view';

export const metadata = { title: 'Saved' };
export const dynamic = 'force-dynamic';

/**
 * The stories saved from Quick read and the issue page (plan #870), newest
 * saved first. #867 settled on one list, so there are no collections to pick
 * between. Each story is the copy taken when it was saved, so it stays whole
 * after its newsletter is deleted; only the link to the newsletter goes.
 */
export default async function SavedPage() {
  const user = await requireUser();
  const client = await createNewsClient();
  const [settings, stories] = await Promise.all([
    loadAccountSettings(user.id),
    loadSavedStories(client),
  ]);

  return (
    <SavedView
      stories={stories.map((story) => ({
        ...story,
        arrived: formatArrival(story.receivedAt, settings.timezone),
      }))}
    />
  );
}

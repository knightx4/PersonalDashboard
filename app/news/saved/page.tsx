import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { formatArrival } from '@/lib/news/issues/list';
import { discussedIndexes } from '@/lib/news/saved/discussed';
import { loadStoryConversations } from '@/lib/news/saved/discussed-store';
import { loadSavedStories } from '@/lib/news/saved/stories';
import { loadSentBySaved } from '@/lib/news/saved/sent';
import { createVaultClient } from '@/lib/vault/auth/server';
import { relatedNotes, toLink } from '@/lib/vault/notes/related';
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
 *
 * Each story shows up to two of your own notes on its subject (plan #1113),
 * matched on its headline and summary. A saved story is a copy that outlives
 * its newsletter, so it is matched on its own words rather than on the
 * newsletter's stored vector; the vector is kept by the text's hash, so a
 * story costs one embedding call the first time the list shows it. The
 * lookups are started and not awaited, and stream in under each story.
 *
 * Where each story has been sent, to Learn or Todo (plan #1370), is read once
 * the stories are, so Send to Learn and Make a todo say so after a reload.
 */
export default async function SavedPage() {
  const user = await requireUser();
  const [client, core, vault] = await Promise.all([
    createNewsClient(),
    createCoreClient(),
    createVaultClient(),
  ]);
  const [settings, stories, conversations] = await Promise.all([
    loadAccountSettings(user.id),
    loadSavedStories(client),
    loadStoryConversations(core).catch(() => []),
  ]);
  const discussed = discussedIndexes(stories, conversations);
  const sent = await loadSentBySaved(stories.map((story) => story.id));

  return (
    <SavedView
      stories={stories.map((story) => ({
        ...story,
        arrived: formatArrival(story.receivedAt, settings.timezone),
        discussedIndex: discussed.get(story.id) ?? null,
        sent: sent.get(story.id) ?? null,
        related: relatedNotes(vault, user.id, `${story.headline}\n${story.summary}`, {
          core,
        }).then((notes) => notes.map(toLink)),
      }))}
    />
  );
}

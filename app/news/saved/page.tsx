import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { formatArrival } from '@/lib/news/issues/list';
import { discussedIndexes } from '@/lib/news/saved/discussed';
import { loadDiscussedStoryIds, loadIssueStories } from '@/lib/news/saved/discussed-store';
import { loadSavedStories } from '@/lib/news/saved/stories';
import { loadSentBySaved } from '@/lib/news/saved/sent';
import { createVaultClient } from '@/lib/vault/auth/server';
import type { DevComment } from '@/lib/comments/load';
import { loadThreads } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
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
 * discussion is the thread under the saved story (plan #1468); each discussed
 * story is found in its newsletter by headline so the sheet can open it
 * (lib/news/saved/discussed.ts). A failed read of either leaves the list
 * without the marks rather than failing the page.
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
 * Each story's thread (plan #1471) is read at the same time.
 */
export default async function SavedPage() {
  const user = await requireUser();
  const [client, core, vault] = await Promise.all([
    createNewsClient(),
    createCoreClient(),
    createVaultClient(),
  ]);
  const [settings, stories, discussedIds] = await Promise.all([
    loadAccountSettings(user.id),
    loadSavedStories(client),
    loadDiscussedStoryIds(core).catch(() => new Set<string>()),
  ]);
  const discussedIssues = stories
    .filter((story) => story.issueId && discussedIds.has(story.id))
    .map((story) => story.issueId as string);
  const issueStories = await loadIssueStories(client, discussedIssues).catch(() => new Map<string, unknown[]>());
  const discussed = discussedIndexes(stories, discussedIds, issueStories);
  const [sent, threads] = await Promise.all([
    loadSentBySaved(stories.map((story) => story.id)),
    // A failed read leaves the threads empty rather than the page broken.
    loadThreads(
      core,
      stories.map((story) => threadRef('story', story.id)),
      { userId: user.id },
    ).catch(() => new Map<string, DevComment[]>()),
  ]);

  return (
    <SavedView
      stories={stories.map((story) => ({
        ...story,
        arrived: formatArrival(story.receivedAt, settings.timezone),
        discussedIndex: discussed.get(story.id) ?? null,
        sent: sent.get(story.id) ?? null,
        thread: threads.get(threadRef('story', story.id)) ?? [],
        related: relatedNotes(vault, user.id, `${story.headline}\n${story.summary}`, {
          core,
        }).then((notes) => notes.map(toLink)),
      }))}
    />
  );
}

import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { loadSavedHeadlines } from '@/lib/news/saved/stories';
import { loadSentInIssues, sentKey } from '@/lib/news/saved/sent';
import { StoryView } from './story-view';

export const metadata = { title: 'Story' };
export const dynamic = 'force-dynamic';

/**
 * One story from a newsletter, on a page of its own (note a18729e3): what
 * "Read the full story" on the Quick read opens, in place of unfolding the
 * story inside its card. The headline, who sent it and when, the summary, the
 * story as the email told it, and the ways on: the article itself and the
 * whole newsletter. Save, Send to Learn and Make a todo sit under it as they
 * do on every other story (plan #1370). A story opened from the Daily review
 * carries `from=review`, and its back link returns there (plan #1616).
 */
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; index: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id, index }, { from: cameFrom }] = await Promise.all([params, searchParams]);
  // Opened from the Daily review (plan #1616), back goes to the review.
  const back =
    cameFrom === 'review'
      ? { href: '/news/review', label: 'Daily review' }
      : { href: '/news', label: 'News' };
  if (!/^\d{1,3}$/.test(index)) notFound();
  const user = await requireUser();
  const client = await createNewsClient();
  const [settings, issue] = await Promise.all([
    loadAccountSettings(user.id),
    loadIssue(client, id),
  ]);
  const storyIndex = Number(index);
  const story = issue?.digest?.stories[storyIndex];
  if (!issue || !story) notFound();
  const [savedHeadlines, sentIn] = await Promise.all([
    loadSavedHeadlines(client, issue.id),
    loadSentInIssues(client, [issue.id]),
  ]);

  return (
    <StoryView
      back={back}
      issue={issue}
      story={story}
      storyIndex={storyIndex}
      timezone={settings.timezone}
      saved={savedHeadlines.has(story.headline)}
      sent={sentIn.get(sentKey(issue.id, story.headline))}
    />
  );
}

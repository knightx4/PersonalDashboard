import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { formatArrival, issueHref, senderLabel } from '@/lib/news/issues/list';
import { storyParagraphs } from '@/lib/news/issues/stories';
import { loadSavedHeadlines } from '@/lib/news/saved/stories';
import { loadSentInIssues, sentKey } from '@/lib/news/saved/sent';
import { SaveStoryButton } from '@/components/news/save-story-button';
import { SendStoryButtons } from '@/components/news/send-story-buttons';
import { ArticleLink } from '@/app/news/quick/quick-controls';

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
  const sent = sentIn.get(sentKey(issue.id, story.headline));

  const from = issue.sender ? senderLabel(issue.sender) : 'Unknown sender';
  const paragraphs = storyParagraphs(story.text);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={back.href}
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> {back.label}
      </Link>
      <PageHeader
        title={story.headline}
        description={`${from} · ${formatArrival(issue.receivedAt, settings.timezone)}`}
      />
      <Card padding="standard">
        <p className="max-w-prose text-body leading-relaxed text-ink">{story.summary}</p>
        {paragraphs.length > 0 && (
          <div className="mt-4 max-w-prose space-y-3 border-t border-border pt-4">
            {paragraphs.map((paragraph, i) => (
              <p key={i} className="break-words text-body leading-relaxed text-ink">
                {paragraph}
              </p>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {story.link && (
              <ArticleLink href={story.link} issueId={issue.id} storyIndex={storyIndex} />
            )}
            <Link
              href={issueHref(issue.id, { original: false, pictures: true, from: null })}
              className="text-ui text-accent hover:underline"
            >
              Open the whole newsletter
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SendStoryButtons
              story={{ issueId: issue.id, headline: story.headline }}
              readingId={sent?.readingId}
              taskId={sent?.taskId}
            />
            <SaveStoryButton
              issueId={issue.id}
              headline={story.headline}
              saved={savedHeadlines.has(story.headline)}
              className="-mr-2.5"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

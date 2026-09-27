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
import { ArticleLink } from '@/app/news/quick/quick-controls';

export const metadata = { title: 'Story' };
export const dynamic = 'force-dynamic';

/**
 * One story from a newsletter, on a page of its own (note a18729e3): what
 * "Read the full story" on the Quick read opens, in place of unfolding the
 * story inside its card. The headline, who sent it and when, the summary, the
 * story as the email told it, and the ways on: the article itself and the
 * whole newsletter.
 */
export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string; index: string }>;
}) {
  const { id, index } = await params;
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

  const from = issue.sender ? senderLabel(issue.sender) : 'Unknown sender';
  const paragraphs = storyParagraphs(story.text);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/news"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> News
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
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
      </Card>
    </div>
  );
}

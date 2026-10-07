import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { formatArrival, issueHref, senderLabel, type NewsSender } from '@/lib/news/issues/list';
import { storyParagraphs, type NewsStory } from '@/lib/news/issues/stories';
import type { StorySent } from '@/lib/news/saved/sent';
import { SaveStoryButton } from '@/components/news/save-story-button';
import { SendStoryButtons } from '@/components/news/send-story-buttons';
import { ArticleLink } from '@/app/news/quick/quick-controls';

/**
 * One story on its own page, drawn from what the page read (page.tsx), so
 * the gallery can draw it from fixtures (plan #1603).
 */
export function StoryView({
  back,
  issue,
  story,
  storyIndex,
  timezone,
  saved,
  sent,
}: {
  back: { href: string; label: string };
  issue: { id: string; receivedAt: string; sender: NewsSender | null };
  story: NewsStory;
  storyIndex: number;
  timezone: string;
  saved: boolean;
  sent: StorySent | undefined;
}) {
  const from = issue.sender ? senderLabel(issue.sender) : 'Unknown sender';
  const paragraphs = storyParagraphs(story.text);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={back.href}
        className="press-area mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> {back.label}
      </Link>
      <PageHeader
        title={story.headline}
        description={`${from} · ${formatArrival(issue.receivedAt, timezone)}`}
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
          {/* The article link is drawn by Quick read's own control, so its phone
              press area is given from here. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 [&_a]:press-area">
            {story.link && (
              <ArticleLink href={story.link} issueId={issue.id} storyIndex={storyIndex} />
            )}
            <Link
              href={issueHref(issue.id, { original: false, pictures: true, from: null })}
              className="press-area text-ui text-accent hover:underline"
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
              saved={saved}
              className="-mr-2.5"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { Image as ImageIcon, ImageOff, Mail } from 'lucide-react';
import { StoryText } from '@/components/news/story-text';
import { TopicChips, type TopicChipsProps } from '@/components/news/topic-chips';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import type { QuickCard } from '@/lib/news/quick/next';
import { ArticleLink, HideTopicForm, QuickNextForm, QuickSwipe } from './quick-controls';

export type QuickReadViewProps = {
  /** The story to show, or null when there is none left. */
  card: QuickCard | null;
  /** When the card's newsletter arrived, already formatted: "23 Sep, 07:14". */
  arrived: string | null;
  /** Whether no newsletter has been summarised yet, which is not the same as caught up. */
  nothingYet: boolean;
  /** How many topics are hidden with Fewer like this, so caught up can say they are set aside. */
  hiddenCount?: number;
  /** Whether pictures load: on unless the reader turned them off with ?pictures=0. */
  pictures: boolean;
  picturesHref: string;
  /** Where the whole newsletter opens, keeping the pictures setting. */
  issueHref: string | null;
  /** What the caught-up mark is drawn from: the account and the day. */
  seed: string;
  /** The topic chips above the card (plan #860); `selected` is the topic in force. */
  topics: Omit<TopicChipsProps, 'className'>;
};

const DESCRIPTION = 'One story at a time from your newsletters, newest first.';

/**
 * What Quick read draws, split from the page so the preview gallery can render
 * it from a fixture. Loading and working out the card stay in page.tsx.
 */
export function QuickReadView({
  card,
  arrived,
  nothingYet,
  hiddenCount = 0,
  pictures,
  picturesHref,
  issueHref,
  seed,
  topics,
}: QuickReadViewProps) {
  const topic = topics.selected;
  const chips = <TopicChips {...topics} className="mb-4" />;

  if (!card) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Quick read" description={DESCRIPTION} />
        {chips}
        {topic ? (
          <EmptyState
            tone="finished"
            seed={seed}
            title={`Nothing left on ${topic}`}
            description="You have been through every story on this topic from the newsletters you have not muted. The other topics are still waiting."
            action={{ label: 'Show every topic', href: topics.allHref }}
          />
        ) : nothingYet ? (
          <EmptyState
            icon={Mail}
            title="Nothing to read yet"
            description="Each newsletter's stories show here once it has been summarised, a few seconds after it arrives. Sign one up with the address in News settings."
            action={{ label: 'Show me my address', href: '/news/settings' }}
          />
        ) : (
          <EmptyState
            tone="finished"
            seed={seed}
            title="You are caught up"
            description={
              hiddenCount
                ? `You have been through every story from the newsletters you have not muted, apart from the ${hiddenCount === 1 ? 'topic' : `${hiddenCount} topics`} you hid. New ones show here as they arrive.`
                : 'You have been through every story from the newsletters you have not muted. New ones show here as they arrive.'
            }
            action={{ label: 'All newsletters', href: '/news/all' }}
          />
        )}
      </div>
    );
  }

  const story = card.kind === 'story' ? card.story : null;
  const headline = story ? story.headline : (card.subject ?? 'No subject');
  const summary = card.kind === 'story' ? card.story.summary : card.summary;
  const image = story?.image ?? null;
  const left = card.remainingInIssue - 1;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Quick read"
        description={DESCRIPTION}
        actions={
          image && (
            <Link
              href={picturesHref}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
            >
              {pictures ? (
                <>
                  <ImageOff className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Hide pictures
                </>
              ) : (
                <>
                  <ImageIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Show pictures
                </>
              )}
            </Link>
          )
        }
      />
      {chips}

      <QuickSwipe key={`${card.issueId}:${card.storyIndex}`}>
        <Card padding="none" className="overflow-hidden">
          <article>
            {pictures && image && (
              // A plain img for the reason given on the issue page: the address
              // is the sender's, and next/image would need every sender's host.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                referrerPolicy="no-referrer"
                className="aspect-[16/9] w-full border-b border-border bg-sunken object-cover"
              />
            )}
            <div className="card-pad">
              <p className="truncate text-ui text-ink-muted">
                {card.from ?? 'Unknown sender'}
                {arrived && ` · ${arrived}`}
              </p>
              <h2 className="mt-1 break-words font-display text-title tracking-tight text-ink">
                {headline}
              </h2>
              <p className="mt-2 break-words text-body leading-relaxed text-ink">{summary}</p>
              {story && <StoryText text={story.text} />}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {story?.link && (
                  <ArticleLink
                    href={story.link}
                    issueId={card.issueId}
                    storyIndex={card.storyIndex}
                  />
                )}
                {issueHref && (
                  <Link href={issueHref} className="text-ui text-accent hover:underline">
                    {card.kind === 'essay' ? 'Read the newsletter' : 'Open the whole newsletter'}
                  </Link>
                )}
              </div>
            </div>
            <div className="card-pad-x flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
              <p className="text-ui text-ink-muted">
                {left === 0
                  ? `The last ${topic ? `${topic} story` : 'story'} from this newsletter`
                  : `${left} more ${topic ? `on ${topic} ` : ''}from this newsletter`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {story?.topic && <HideTopicForm topic={story.topic} />}
                <QuickNextForm issueId={card.issueId} storyIndex={card.storyIndex} />
              </div>
            </div>
          </article>
        </Card>
      </QuickSwipe>
    </div>
  );
}

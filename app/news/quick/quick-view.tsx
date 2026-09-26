import Link from 'next/link';
import { Image as ImageIcon, ImageOff, Mail } from 'lucide-react';
import { AlsoInLine } from '@/components/news/also-in';
import { SaveStoryButton } from '@/components/news/save-story-button';
import { StoryGrid, type GridStory } from '@/components/news/story-grid';
import { StoryText } from '@/components/news/story-text';
import { TopicChips, type TopicChipsProps } from '@/components/news/topic-chips';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { cardPasses, type QuickCard } from '@/lib/news/quick/next';
import type { Reaction } from '@/lib/news/quick/reactions';
import {
  ArticleLink,
  QuickDeck,
  QuickNextForm,
  QuickPageForm,
  QuickSwipe,
  ReactionButtons,
} from './quick-controls';

export type QuickReadViewProps = {
  /** The story to show, or null when there is none left. */
  card: QuickCard | null;
  /** When the card's newsletter arrived, already formatted: "23 Sep, 07:14". */
  arrived: string | null;
  /** Whether no newsletter has been summarised yet, which is not the same as caught up. */
  nothingYet: boolean;
  /** How many topics are hidden in News settings, so caught up can say they are set aside. */
  hiddenCount?: number;
  /** Whether the card's story is on the Saved list (plan #869). */
  saved?: boolean;
  /** The thumbs up or down already pressed on the card, if any. */
  reaction?: Reaction | null;
  /** Whether pictures load: on unless the reader turned them off with ?pictures=0. */
  pictures: boolean;
  picturesHref: string;
  /** Where the whole newsletter opens, keeping the pictures setting. */
  issueHref: string | null;
  /** What the caught-up mark is drawn from: the account and the day. */
  seed: string;
  /** The topic chips above the card (plan #860); `selected` is the topic in force. */
  topics: Omit<TopicChipsProps, 'className'>;
  /**
   * The laptop page (plan #941): the stories the grid shows from md up, the
   * first of them `card` or a picture story moved ahead of it. Left out, the
   * single card shows at every width, as it did before the grid.
   */
  page?: readonly QuickPageStory[];
  /**
   * The story Next shows after this one, drawn ahead so the phone card
   * changes the moment Next is pressed (note 452a90d9). Left out, Next waits
   * for the page to come back.
   */
  upNext?: QuickPageStory | null;
};

/** One story of the laptop page, with what the grid card needs beside the story. */
export type QuickPageStory = {
  card: QuickCard;
  arrived: string | null;
  saved: boolean;
  /** The thumbs up or down already pressed on it; left out, none. */
  reaction?: Reaction | null;
  issueHref: string;
};

/**
 * What Quick read draws, split from the page so the preview gallery can render
 * it from a fixture. Loading and working out the card stay in page.tsx.
 */
export function QuickReadView({
  card,
  arrived,
  nothingYet,
  hiddenCount = 0,
  saved = false,
  reaction = null,
  pictures,
  picturesHref,
  issueHref,
  seed,
  topics,
  page = [],
  upNext = null,
}: QuickReadViewProps) {
  const topic = topics.selected;
  // No description under the title, and the chips pulled up to it: the page is
  // read every day, the line said what it is to somebody who already knew, and
  // the laptop page is meant to fit one screen down to its Next page button
  // (note 85fc201a).
  const chips = <TopicChips {...topics} className="-mt-2 mb-3" />;

  if (!card) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Quick read" />
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
  const image = story?.image ?? null;
  const grid = page.length > 0;
  // The pictures button shows where there is a picture to hide: on a phone
  // when the card has one, on a laptop when any story on the page has one.
  const pagePictures = page.some(({ card: c }) => c.kind === 'story' && Boolean(c.story.image));
  const phonePictures = Boolean(image);
  const showToggle = grid ? phonePictures || pagePictures : phonePictures;
  const toggleWidth =
    !grid || phonePictures === pagePictures
      ? ''
      : phonePictures
        ? 'md:hidden'
        : 'hidden md:inline-flex';

  return (
    <div className={cn('mx-auto max-w-2xl', grid && 'md:max-w-5xl')}>
      <PageHeader
        title="Quick read"
        actions={
          showToggle && (
            <Link
              href={picturesHref}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), toggleWidth)}
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

      {/* One card below md and the grid from md up, chosen by CSS so the server never needs the screen size. */}
      <div className={grid ? 'md:hidden' : undefined}>
        <QuickDeck
          key={`${card.issueId}:${card.storyIndex}`}
          current={
            <PhoneCard
              card={card}
              arrived={arrived}
              saved={saved}
              reaction={reaction}
              pictures={pictures}
              issueHref={issueHref}
              topic={topic}
            />
          }
          next={
            upNext && (
              <PhoneCard
                card={upNext.card}
                arrived={upNext.arrived}
                saved={upNext.saved}
                reaction={upNext.reaction ?? null}
                pictures={pictures}
                issueHref={upNext.issueHref}
                topic={topic}
              />
            )
          }
          nextImage={
            pictures && upNext?.card.kind === 'story' ? (upNext.card.story.image ?? null) : null
          }
        />
      </div>

      {grid && (
        <div className="hidden md:block">
          <StoryGrid
            stories={page.map((story) => gridStory(story, pictures))}
            pictures={pictures}
            compact
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-ui text-ink-muted">
              Next page marks {page.length === 1 ? 'this story' : `all ${page.length} stories`} as
              seen.
            </p>
            <QuickPageForm stories={page.flatMap(({ card: c }) => cardPasses(c))} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One story as the phone card draws it: the current one, or the one drawn
 * ahead of it for Next.
 */
function PhoneCard({
  card,
  arrived,
  saved,
  reaction,
  pictures,
  issueHref,
  topic,
}: {
  card: QuickCard;
  arrived: string | null;
  saved: boolean;
  reaction: Reaction | null;
  pictures: boolean;
  issueHref: string | null;
  topic: string | null;
}) {
  const story = card.kind === 'story' ? card.story : null;
  const headline = story ? story.headline : (card.subject ?? 'No subject');
  const summary = card.kind === 'story' ? card.story.summary : card.summary;
  const image = story?.image ?? null;
  const left = card.remainingInIssue - 1;
  return (
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
            <AlsoInLine reason={card.reason} alsoIn={card.alsoIn} pictures={pictures} />
            <h2 className="mt-1 break-words font-display text-title tracking-tight text-ink">
              {headline}
            </h2>
            <p className="mt-2 break-words text-body leading-relaxed text-ink">{summary}</p>
            {story && <StoryText text={story.text} summary={summary} />}
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
              {story && (
                <SaveStoryButton issueId={card.issueId} headline={story.headline} saved={saved} />
              )}
              <ReactionButtons
                issueId={card.issueId}
                storyIndex={card.storyIndex}
                reaction={reaction}
              />
              <QuickNextForm stories={cardPasses(card)} />
            </div>
          </div>
        </article>
      </Card>
    </QuickSwipe>
  );
}

/**
 * One laptop-page story as the grid draws it. The article link is the
 * recording ArticleLink rather than the grid's own, so opening one still
 * counts as seen, and an essay, which has no article, links to its newsletter.
 */
function gridStory(
  { card, arrived, saved, reaction = null, issueHref }: QuickPageStory,
  pictures: boolean,
): GridStory {
  const from = [card.from ?? 'Unknown sender', arrived].filter(Boolean).join(' · ');
  if (card.kind === 'essay') {
    return {
      key: `${card.issueId}:${card.storyIndex}`,
      headline: card.subject ?? 'No subject',
      summary: card.summary,
      from,
      actions: (
        <>
          <Link href={issueHref} className="text-ui text-accent hover:underline">
            Read the newsletter
          </Link>
          <ReactionButtons
            issueId={card.issueId}
            storyIndex={card.storyIndex}
            reaction={reaction}
          />
        </>
      ),
    };
  }
  const { story } = card;
  return {
    key: `${card.issueId}:${card.storyIndex}`,
    headline: story.headline,
    summary: story.summary,
    image: story.image ?? null,
    from,
    body: (
      <>
        <AlsoInLine
          reason={card.reason}
          alsoIn={card.alsoIn}
          pictures={pictures}
          className="mt-1.5"
        />
        <StoryText text={story.text} summary={story.summary} />
      </>
    ),
    actions: (
      <>
        {story.link && (
          <ArticleLink href={story.link} issueId={card.issueId} storyIndex={card.storyIndex} />
        )}
        <SaveStoryButton issueId={card.issueId} headline={story.headline} saved={saved} />
        <ReactionButtons issueId={card.issueId} storyIndex={card.storyIndex} reaction={reaction} />
      </>
    ),
  };
}

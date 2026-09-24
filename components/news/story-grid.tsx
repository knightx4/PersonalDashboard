import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { gridSpans, type GridSpan } from '@/lib/news/story-grid';

/**
 * One story as the grid draws it. Quick read builds these from a QuickCard and
 * a newsletter's page from its digest's stories, so the grid knows neither.
 */
export type GridStory = {
  /** Unique on the page and stable across renders, such as "issueId:storyIndex". */
  key: string;
  headline: string;
  summary: string;
  /** The story's picture, when the email had one. Most stories before 23 September have none. */
  image?: string | null;
  /** The newsletter's name, shown above the headline. Leave it out on a newsletter's own page. */
  from?: string | null;
  /**
   * The article, drawn as "Read the article" at the foot of the card. Leave it
   * out and put your own link in `actions` when the click has to be recorded.
   */
  link?: string | null;
  /** Under the summary, such as the full-story fold. It may grow the card. */
  body?: React.ReactNode;
  /** The far end of the card's foot: Save, Fewer like this and the like. */
  actions?: React.ReactNode;
};

export type StoryGridProps = {
  /** In reading order. The first is the lead. */
  stories: readonly GridStory[];
  /** Whether pictures load: off when the reader turned them off. */
  pictures: boolean;
  className?: string;
};

/*
 * How many columns each card spans, per breakpoint, written out whole so
 * Tailwind finds every class. One column below md, two from md, three from lg.
 */
const MD_SPAN = { 1: '', 2: 'md:col-span-2' } as const;
const LG_SPAN = { 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3' } as const;
/** A picture keeps to a strip as its card widens, so a wide card is not mostly picture. */
const MD_ASPECT = { 1: '', 2: 'md:aspect-[2/1]' } as const;
const LG_ASPECT = { 1: 'lg:aspect-[16/9]', 2: 'lg:aspect-[2/1]', 3: 'lg:aspect-[3/1]' } as const;

/**
 * Stories side by side like a magazine page (plan #940): a lead across two
 * columns with its picture large, the rest in smaller cards beside and below
 * it. Rows take the height of their tallest card and the others stretch to
 * meet it, with the foot pinned to the bottom, so cards of different lengths
 * line up without fixed tiles. Below md it is one column.
 */
export function StoryGrid({ stories, pictures, className }: StoryGridProps) {
  const spans = gridSpans(stories.length, { tallLead: pictures && Boolean(stories[0]?.image) });
  return (
    <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
      {stories.map((story, index) => {
        const span = spans[index];
        return (
          <StoryGridCard
            key={story.key}
            story={story}
            lead={index === 0}
            pictures={pictures}
            span={span}
            className={cn(MD_SPAN[span.md], LG_SPAN[span.lg], span.tall && 'lg:row-span-2')}
          />
        );
      })}
    </div>
  );
}

function StoryGridCard({
  story,
  lead,
  pictures,
  span,
  className,
}: {
  story: GridStory;
  lead: boolean;
  pictures: boolean;
  span: GridSpan;
  className?: string;
}) {
  const image = pictures ? story.image : null;
  const Heading = lead ? 'h2' : 'h3';
  return (
    <Card padding="none" className={cn('flex flex-col overflow-hidden', className)}>
      <article className="flex flex-1 flex-col">
        {image && (
          // A plain img for the reason given on the issue page: the address is
          // the sender's, and next/image would need every sender's host listed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            loading={lead ? undefined : 'lazy'}
            referrerPolicy="no-referrer"
            className={cn(
              'aspect-[16/9] w-full border-b border-border bg-sunken object-cover',
              MD_ASPECT[span.md],
              LG_ASPECT[span.lg],
            )}
          />
        )}
        <div className="card-pad flex flex-1 flex-col">
          {story.from && <p className="truncate text-ui text-ink-muted">{story.from}</p>}
          <Heading
            className={cn(
              'break-words text-ink',
              story.from && 'mt-1',
              lead ? 'font-display text-title tracking-tight' : 'text-body font-semibold',
            )}
          >
            {story.headline}
          </Heading>
          <p
            className={cn(
              'mt-1.5 break-words text-body leading-relaxed',
              lead ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {story.summary}
          </p>
          {story.body}
          {(story.link || story.actions) && (
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-3">
              {story.link ? (
                <a
                  href={story.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-ui text-accent hover:underline"
                >
                  Read the article
                  <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
                </a>
              ) : (
                <span aria-hidden />
              )}
              {story.actions && (
                <div className="flex flex-wrap items-center gap-2">{story.actions}</div>
              )}
            </div>
          )}
        </div>
      </article>
    </Card>
  );
}

import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ImageOff,
  Mail,
} from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardSection } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { SaveStoryButton } from '@/components/news/save-story-button';
import { StoryGrid } from '@/components/news/story-grid';
import { StoryText } from '@/components/news/story-text';
import type { NewsStory } from '@/lib/news/issues/stories';
import { markIssueUnread } from './actions';
import { IssueFrame } from './issue-frame';

export type IssueViewProps = {
  issueId: string;
  subject: string | null;
  /** Sender and arrival, already formatted: "Stratechery · 23 Sep, 07:14". */
  byline: string;
  back: { href: string; label: string };
  digest: { summary: string; stories: NewsStory[] } | null;
  digestError: string | null;
  /** The summary is the page when there is one, unless the original was asked for. */
  showDigest: boolean;
  html: string | null;
  textBody: string | null;
  /** Whether pictures load: on unless the reader turned them off. */
  pictures: boolean;
  /**
   * The pictures on what is showing: the stories' thumbnails on the summary,
   * the email's pictures on the original. No picture button when it is zero.
   */
  pictureCount: number;
  /** Pictures held back from the original email while pictures are off. */
  blockedImages: number;
  unsubscribeUrl: string | null;
  picturesHref: string;
  originalHref: string;
  summaryHref: string;
  /** Headlines of this issue's stories on the Saved list, so each reads Save or Saved. */
  savedHeadlines?: readonly string[];
};

/**
 * What the issue page draws once the issue is loaded, split from the page so
 * the preview gallery can render it from a fixture. Loading, marking read and
 * building the links stay in page.tsx.
 */
export function IssueView({
  issueId,
  subject,
  byline,
  back,
  digest,
  digestError,
  showDigest,
  html,
  textBody,
  pictures,
  pictureCount,
  blockedImages,
  unsubscribeUrl,
  picturesHref,
  originalHref,
  summaryHref,
  savedHeadlines = [],
}: IssueViewProps) {
  const isSaved = (story: NewsStory) => savedHeadlines.includes(story.headline);
  // From md up a summarised issue's stories are a grid (plan #942), so the
  // page widens to hold it. An essay, the original email and anything below
  // md keep the one column they had.
  const grid = showDigest && digest !== null && digest.stories.length > 0;
  return (
    <div className={cn('mx-auto max-w-3xl', grid && 'md:max-w-5xl')}>
      <p className="mb-3">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {back.label}
        </Link>
      </p>

      <PageHeader
        title={subject ?? 'No subject'}
        description={byline}
        actions={
          <>
            {digest &&
              (showDigest && digest ? (
                <Link
                  href={originalHref}
                  className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
                >
                  <Mail className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Original email
                </Link>
              ) : (
                <Link
                  href={summaryHref}
                  className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
                >
                  <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Summary
                </Link>
              ))}
            {pictureCount > 0 && (
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
                    {showDigest || blockedImages === 0
                      ? 'Show pictures'
                      : blockedImages === 1
                        ? 'Show 1 picture'
                        : `Show ${blockedImages} pictures`}
                  </>
                )}
              </Link>
            )}
            <form action={markIssueUnread}>
              <input type="hidden" name="issueId" value={issueId} />
              <Button type="submit" size="sm" variant="secondary">
                Mark unread
              </Button>
            </form>
            {/*
              A plain link rather than a form, because nothing is sent on your
              behalf: the publisher's own page does the unsubscribing, and all
              this does is open it. No confirm either -- #683 asks before a
              mail goes, and there is no mail here to send.

              Only for an issue that carried a link. An issue that carried only
              an address is #667's, which sends the mail through Mailgun; an
              issue that carried neither gets no button, and that is most of
              the list, since only issues delivered after #614 shipped kept the
              header at all.
            */}
            {unsubscribeUrl && (
              <a
                href={unsubscribeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                Unsubscribe
              </a>
            )}
          </>
        }
      />

      {!digest && digestError && (
        <p className="mb-3 text-ui text-ink-muted">
          This issue could not be summarised, so it is shown as it arrived.
        </p>
      )}

      {showDigest && digest ? (
        <div className="space-y-5">
          <Card padding="standard">
            <p className="break-words text-body leading-relaxed text-ink">{digest.summary}</p>
          </Card>
          {grid && (
            <StoryGrid
              className="hidden md:grid"
              stories={digest.stories.map((story, index) => ({
                key: `${issueId}:${index}`,
                headline: story.headline,
                summary: story.summary,
                image: story.image ?? null,
                link: story.link ?? null,
                body: <StoryText text={story.text} summary={story.summary} />,
                actions: (
                  <SaveStoryButton
                    issueId={issueId}
                    headline={story.headline}
                    saved={isSaved(story)}
                    className="-mr-2.5"
                  />
                ),
              }))}
              pictures={pictures}
            />
          )}
          {digest.stories.length > 0 && (
            <div className="md:hidden">
              <LeadStory
                story={digest.stories[0]}
                pictures={pictures}
                issueId={issueId}
                saved={isSaved(digest.stories[0])}
              />
            </div>
          )}
          {digest.stories.length > 1 && (
            <CardSection title="More stories" className="md:hidden">
              <ul className="divide-y divide-border">
                {digest.stories.slice(1).map((story, index) => (
                  <li key={index} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words text-body font-semibold text-ink">
                          {story.headline}
                        </h3>
                        <p className="mt-1 text-body leading-relaxed text-ink-muted">
                          {story.summary}
                        </p>
                      </div>
                      {pictures && story.image && (
                        // A plain img: the address is the sender's, fetched by
                        // the browser as the email's own pictures are, and
                        // next/image would need every sender's host listed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={story.image}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="size-20 shrink-0 rounded-card bg-sunken object-cover sm:size-24"
                        />
                      )}
                    </div>
                    <StoryText text={story.text} summary={story.summary} />
                    <StoryActions story={story} issueId={issueId} saved={isSaved(story)} />
                  </li>
                ))}
              </ul>
            </CardSection>
          )}
        </div>
      ) : html ? (
        <IssueFrame html={html} />
      ) : (
        <Card>
          <CardBody>
            {textBody ? (
              <div className="whitespace-pre-wrap break-words text-body leading-relaxed text-ink">
                {textBody}
              </div>
            ) : (
              <p className="text-body text-ink-muted">
                This one arrived with nothing in it to show.
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/**
 * The issue's first story, given the most room so the page says where to
 * start (plan #856): its picture across the card's full width, its headline a
 * size up. With pictures off, or no picture in the email, it is the larger
 * headline alone. The fold, the link and Save are the same as every other story's.
 */
function LeadStory({
  story,
  pictures,
  issueId,
  saved,
}: {
  story: NewsStory;
  pictures: boolean;
  issueId: string;
  saved: boolean;
}) {
  return (
    <Card padding="none" className="overflow-hidden">
      {pictures && story.image && (
        // A plain img for the same reason as the smaller ones below.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.image}
          alt=""
          referrerPolicy="no-referrer"
          className="aspect-[16/9] w-full bg-sunken object-cover sm:aspect-[2/1]"
        />
      )}
      <div className="card-pad">
        <h2 className="break-words text-title font-semibold tracking-tight text-ink">
          {story.headline}
        </h2>
        <p className="mt-2 text-body leading-relaxed text-ink-muted">{story.summary}</p>
        <StoryText text={story.text} summary={story.summary} />
        <StoryActions story={story} issueId={issueId} saved={saved} />
      </div>
    </Card>
  );
}

/**
 * Under each story: the article, when the email linked one, and Save (plan
 * #869). Save sits at the far end so it lands in the same place on every
 * story, linked or not.
 */
function StoryActions({
  story,
  issueId,
  saved,
}: {
  story: NewsStory;
  issueId: string;
  saved: boolean;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
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
      <SaveStoryButton
        issueId={issueId}
        headline={story.headline}
        saved={saved}
        className="-mr-2.5"
      />
    </div>
  );
}

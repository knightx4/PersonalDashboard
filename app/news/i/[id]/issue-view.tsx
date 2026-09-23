import Link from 'next/link';
import { ArrowLeft, ExternalLink, FileText, Image as ImageIcon, Mail } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardSection } from '@/components/ui/card';
import { cn } from '@/lib/cn';
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
  blockedImages: number;
  unsubscribeUrl: string | null;
  picturesHref: string;
  originalHref: string;
  summaryHref: string;
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
  blockedImages,
  unsubscribeUrl,
  picturesHref,
  originalHref,
  summaryHref,
}: IssueViewProps) {
  return (
    <div className="mx-auto max-w-3xl">
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
            {!showDigest && blockedImages > 0 && (
              <Link
                href={picturesHref}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                <ImageIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
                {blockedImages === 1 ? 'Show 1 picture' : `Show ${blockedImages} pictures`}
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
          {digest.stories.length > 0 && (
            <CardSection title="Stories">
              <ul className="divide-y divide-border">
                {digest.stories.map((story, index) => (
                  <li key={index} className="py-3 first:pt-0 last:pb-0">
                    <h3 className="break-words text-body font-semibold text-ink">{story.headline}</h3>
                    <p className="mt-1 text-body leading-relaxed text-ink-muted">
                      {story.summary}
                    </p>
                    {story.link && (
                      <a
                        href={story.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-ui text-accent hover:underline"
                      >
                        Read the article
                        <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
                      </a>
                    )}
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

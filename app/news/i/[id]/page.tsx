import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { cn } from '@/lib/cn';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { formatArrival, issueReturn, senderLabel } from '@/lib/news/issues/list';
import { markRead } from '@/lib/news/issues/read';
import { cleanIssueHtml } from '@/lib/news/issues/sanitize';
import { markIssueUnread } from './actions';
import { IssueFrame } from './issue-frame';

export const metadata = { title: 'Newsletter' };
export const dynamic = 'force-dynamic';

/**
 * One newsletter, opened.
 *
 * Opening it is what marks it read, so the home tile drops by one on the way
 * in and there is no button to press to say you have read what you are looking
 * at. "Mark unread" is on the page for the issue you opened by mistake or want
 * to come back to.
 *
 * Pictures are a link rather than a switch, so the choice survives a reload
 * and costs no script: `?pictures=1` is the reader asking for them, and until
 * it is there nothing in the issue is fetched from the sender. That is what
 * keeps a tracking pixel from reporting the issue as opened.
 *
 * Unsubscribe is shown only for an issue whose sender offered a link in its
 * List-Unsubscribe header, and it opens that link in a new tab.
 *
 * An issue with no HTML half is shown as the text it was sent as.
 */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pictures?: string; from?: string }>;
}) {
  const { id } = await params;
  const { pictures, from: cameFrom } = await searchParams;
  const user = await requireUser();
  const client = await createNewsClient();

  const [settings, issue] = await Promise.all([
    loadAccountSettings(user.id),
    loadIssue(client, id),
  ]);
  if (!issue) notFound();

  if (!issue.readAt) await markRead(client, issue.id);

  const sender = issue.sender;
  const from = sender ? senderLabel(sender) : 'Unknown sender';
  const wanted = pictures === '1';
  const { html, blockedImages } = cleanIssueHtml(issue.htmlBody, wanted);
  const back = issueReturn(cameFrom, sender);
  /** Asking for the pictures reloads this page, and keeps where you were with it. */
  const picturesHref = `/news/i/${issue.id}?pictures=1${back.from ? `&from=${back.from}` : ''}`;

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
        title={issue.subject ?? 'No subject'}
        description={`${from} · ${formatArrival(issue.receivedAt, settings.timezone)}`}
        actions={
          <>
            {blockedImages > 0 && (
              <Link
                href={picturesHref}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                <ImageIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
                {blockedImages === 1 ? 'Show 1 picture' : `Show ${blockedImages} pictures`}
              </Link>
            )}
            <form action={markIssueUnread}>
              <input type="hidden" name="issueId" value={issue.id} />
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
            {issue.unsubscribeUrl && (
              <a
                href={issue.unsubscribeUrl}
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

      {html ? (
        <IssueFrame html={html} />
      ) : (
        <Card>
          <CardBody>
            {issue.textBody ? (
              <div className="whitespace-pre-wrap break-words text-body leading-relaxed text-ink">
                {issue.textBody}
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

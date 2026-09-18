import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { cn } from '@/lib/cn';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { formatArrival, senderLabel } from '@/lib/news/issues/list';
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
 * An issue with no HTML half is shown as the text it was sent as.
 */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pictures?: string }>;
}) {
  const { id } = await params;
  const { pictures } = await searchParams;
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

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-3">
        <Link
          href={sender ? `/news?from=${sender.id}` : '/news'}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {sender ? from : 'Newsletters'}
        </Link>
      </p>

      <PageHeader
        title={issue.subject ?? 'No subject'}
        description={`${from} · ${formatArrival(issue.receivedAt, settings.timezone)}`}
        actions={
          <>
            {blockedImages > 0 && (
              <Link
                href={`/news/i/${issue.id}?pictures=1`}
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

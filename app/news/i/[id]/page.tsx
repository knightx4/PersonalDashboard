import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { formatArrival, senderLabel } from '@/lib/news/issues/list';
import { markRead } from '@/lib/news/issues/read';
import { markIssueUnread } from './actions';

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
 * The body here is the plain-text half of the message. The formatted half is
 * shown the way #445 settled -- inside a sandboxed frame -- and that frame is
 * #460, which cleans the HTML first.
 */
export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
          <form action={markIssueUnread}>
            <input type="hidden" name="issueId" value={issue.id} />
            <Button type="submit" size="sm" variant="secondary">
              Mark unread
            </Button>
          </form>
        }
      />

      <Card>
        <CardBody>
          {issue.textBody ? (
            <div className="whitespace-pre-wrap break-words text-body leading-relaxed text-ink">
              {issue.textBody}
            </div>
          ) : (
            <p className="text-body text-ink-muted">
              This one was sent as formatted mail with no plain-text half, so there is nothing to
              show here until the reading frame is in.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

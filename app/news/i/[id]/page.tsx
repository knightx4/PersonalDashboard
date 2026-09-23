import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { formatArrival, issueHref, issueReturn, senderLabel } from '@/lib/news/issues/list';
import { markRead } from '@/lib/news/issues/read';
import { cleanIssueHtml } from '@/lib/news/issues/sanitize';
import { IssueView } from './issue-view';

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
 *
 * A summarised issue opens on its summary and stories, and the email as it
 * arrived is behind `?view=original`, a link for the same reason the pictures
 * are. An issue with no summary opens on the email: either it has not been
 * summarised yet (new issues are, a few seconds after they arrive) or the
 * summary failed, and a failure gets one line above the email saying so.
 */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pictures?: string; from?: string; view?: string }>;
}) {
  const { id } = await params;
  const { pictures, from: cameFrom, view } = await searchParams;
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
  const digest = issue.digest;
  const showDigest = digest !== null && view !== 'original';
  /** Asking for the pictures reloads this page, and keeps where you were with it. */
  const picturesHref = issueHref(issue.id, {
    original: digest !== null,
    pictures: true,
    from: back.from,
  });
  const originalHref = issueHref(issue.id, { original: true, pictures: wanted, from: back.from });
  const summaryHref = issueHref(issue.id, { original: false, pictures: wanted, from: back.from });

  return (
    <IssueView
      issueId={issue.id}
      subject={issue.subject}
      byline={`${from} · ${formatArrival(issue.receivedAt, settings.timezone)}`}
      back={back}
      digest={digest}
      digestError={issue.digestError}
      showDigest={showDigest}
      html={html}
      textBody={issue.textBody}
      blockedImages={blockedImages}
      unsubscribeUrl={issue.unsubscribeUrl}
      picturesHref={picturesHref}
      originalHref={originalHref}
      summaryHref={summaryHref}
    />
  );
}

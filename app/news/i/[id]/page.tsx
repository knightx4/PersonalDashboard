import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssue } from '@/lib/news/issues/load';
import { formatArrival, issueHref, issueReturn, senderLabel } from '@/lib/news/issues/list';
import { markRead } from '@/lib/news/issues/read';
import { cleanIssueHtml } from '@/lib/news/issues/sanitize';
import { loadSavedHeadlines } from '@/lib/news/saved/stories';
import { loadElsewhere } from '@/lib/news/issues/elsewhere';
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
 * Pictures load unless the reader turned them off with `?pictures=0`, a link
 * rather than a switch so the choice survives a reload and costs no script.
 * They were off by default until the reader said they did not mind the sender
 * seeing the issue opened; a sender that never sees an open can drop the
 * address from its list as inactive. The same setting covers the thumbnails
 * beside the stories, which load straight from the sender too.
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

  // Only a summarised issue shows its stories, so only one of those has any
  // to mark Saved. After the notFound, since a saved-stories read on an id
  // that is not a uuid would fail rather than come back empty.
  // Where else each story ran (plan #865) is read beside it, for the same reason.
  const [saved, elsewhere] = issue.digest
    ? await Promise.all([
        loadSavedHeadlines(client, issue.id),
        loadElsewhere(client, issue.id, issue.sender?.id ?? null),
      ])
    : [new Set<string>(), {}];

  if (!issue.readAt) await markRead(client, issue.id);

  const sender = issue.sender;
  const from = sender ? senderLabel(sender) : 'Unknown sender';
  const wanted = pictures !== '0';
  const { html, blockedImages, images } = cleanIssueHtml(issue.htmlBody, wanted);
  const back = issueReturn(cameFrom, sender);
  const digest = issue.digest;
  const showDigest = digest !== null && view !== 'original';
  /** Turning the pictures on or off reloads this page, and keeps where you were with it. */
  const picturesHref = issueHref(issue.id, {
    original: digest !== null && !showDigest,
    pictures: !wanted,
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
      pictures={wanted}
      pictureCount={showDigest ? digest.stories.filter((story) => story.image).length : images}
      blockedImages={blockedImages}
      unsubscribeUrl={issue.unsubscribeUrl}
      picturesHref={picturesHref}
      originalHref={originalHref}
      summaryHref={summaryHref}
      savedHeadlines={[...saved]}
      elsewhere={elsewhere}
    />
  );
}

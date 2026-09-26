import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { replyMailto } from '@/lib/email/gmail-open';
import { fetchConversation } from '@/lib/inbox/fetch-conversation';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { AppShell } from '@/components/shell/app-shell';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { BackButton, EmailFrame } from './reader';

export const metadata = { title: 'Email' };

/**
 * An email, read inside the dashboard.
 *
 * This is where "Open in Gmail" goes on a phone. A Gmail web link names the
 * conversation after a `#`, which the desktop site follows and mobile Gmail
 * ignores, so on a phone every link landed on the inbox. Bodies are never
 * stored, so the conversation is fetched from Gmail each time the page opens.
 */
export default async function MailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const core = await createCoreClient();
  const [settings, counts, raised, mainCheck, owner, conversation] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
    fetchConversation(core, { userId: user.id, gmailId: id }),
  ]);

  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: settings.timezone,
  });
  const messages = conversation.ok ? conversation.messages : [];
  const latest = messages.at(-1);
  const reply = latest ? replyMailto(latest) : null;
  const subject = messages.find((m) => m.subject)?.subject ?? '(no subject)';

  return (
    <div className="min-h-full">
      <AppShell
        account={user.id}
        module={null}
        sections={[]}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        mainCheck={mainCheck}
      >
        <div className="mx-auto max-w-3xl">
          <BackButton />
          <PageHeader
            title={conversation.ok ? subject : 'Email'}
            description={
              conversation.ok && messages.length > 1 ? `${messages.length} messages` : undefined
            }
          />

          <div className="mb-4 flex flex-wrap gap-2">
            {reply && (
              <a href={reply} className={buttonVariants({ variant: 'primary', size: 'md' })}>
                Reply
              </a>
            )}
            {conversation.gmailHref && (
              <a
                href={conversation.gmailHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'md' })}
              >
                Open in Gmail
              </a>
            )}
          </div>

          {!conversation.ok ? (
            <Card padding="standard">
              <p className="text-body text-ink">Could not load this email.</p>
              <p className="mt-1 text-small text-ink-muted">{conversation.reason}</p>
            </Card>
          ) : (
            <Card padding="none">
              <ol className="divide-y divide-border">
                {messages.map((message) => (
                  <li key={message.id} className="card-pad">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 break-words text-ui font-semibold text-ink">
                        {message.fromAddress ?? 'Unknown sender'}
                      </p>
                      {message.internalDate && (
                        <p className="tabular text-small text-ink-muted">
                          {when.format(message.internalDate)}
                        </p>
                      )}
                    </div>
                    {message.html ? (
                      <EmailFrame html={message.html} title={message.subject ?? 'Email'} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-body text-ink">
                        {message.text || '(no text)'}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </AppShell>
    </div>
  );
}

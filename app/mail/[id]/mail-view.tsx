import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { LinkedText } from '@/components/ui/linked-text';
import { PageHeader } from '@/components/shell/page-header';
import { replyMailto } from '@/lib/email/gmail-open';
import type { FetchedConversation } from '@/lib/inbox/fetch-conversation';
import { BackButton, EmailFrame } from './reader';

/**
 * An email as the reader draws it inside the shell (plan #1601): the
 * conversation's messages, oldest first, with Reply and Open in Gmail above
 * them, or why it could not be read. The gallery draws it from fixtures.
 */
export function MailView({
  conversation,
  timezone,
}: {
  conversation: FetchedConversation;
  timezone: string;
}) {
  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
  const messages = conversation.ok ? conversation.messages : [];
  const latest = messages.at(-1);
  const reply = latest ? replyMailto(latest) : null;
  const subject = messages.find((m) => m.subject)?.subject ?? '(no subject)';

  return (
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
                    <LinkedText text={message.text || '(no text)'} />
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

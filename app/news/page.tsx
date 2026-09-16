import { BellOff, Mail } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips } from '@/components/shell/filter-chips';
import { requireUser } from '@/lib/auth/server';
import { cn } from '@/lib/cn';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadIssues, loadSenders } from '@/lib/news/issues/load';
import {
  countLabel,
  formatArrival,
  senderLabel,
  sortSenders,
  visibleIssues,
} from '@/lib/news/issues/list';
import { setSenderMuted } from './actions';

export const metadata = { title: 'Newsletters' };
export const dynamic = 'force-dynamic';

/**
 * What has arrived, newest first.
 *
 * The senders are a column of their own rather than a dropdown, because the
 * question this page is usually opened with is "has the one I read come out
 * yet", and that is answered by seeing the names. A muted sender is still
 * listed there -- muting takes its issues out of the list, not the newsletter
 * out of your life.
 *
 * The confirmation mail a publisher sends when you sign up arrives here like
 * anything else, which is how you reach the link in it.
 */
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const user = await requireUser();
  const client = await createNewsClient();

  const [settings, senders, issues] = await Promise.all([
    loadAccountSettings(user.id),
    loadSenders(client),
    loadIssues(client),
  ]);

  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const selected = from && byId.has(from) ? from : null;
  const shown = visibleIssues(issues, senders, selected);
  const column = sortSenders(senders);

  if (issues.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Newsletters"
          description="What has been sent to the address that belongs to this app."
        />
        <EmptyState
          icon={Mail}
          title="Nothing has arrived yet"
          description="Sign a newsletter up with the address in News settings and every issue it sends lands here, including the mail it sends to confirm you meant it."
          action={{ label: 'Show me my address', href: '/news/settings' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Newsletters"
        description="What has been sent to the address that belongs to this app."
      />

      {selected && (
        <FilterChips
          chips={[
            { label: 'From', value: senderLabel(byId.get(selected)!), clearHref: '/news' },
          ]}
          clearAllHref="/news"
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Filter by sender" className="space-y-1">
          {column.map((sender) => (
            <div key={sender.id} className="flex items-center gap-1">
              <a
                href={selected === sender.id ? '/news' : `/news?from=${sender.id}`}
                aria-current={selected === sender.id ? 'true' : undefined}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-ui transition-colors duration-150 hover:bg-canvas',
                  selected === sender.id ? 'bg-accent-tint font-medium text-ink' : 'text-ink-muted',
                )}
              >
                {senderLabel(sender)}
                {sender.muted && <span className="ml-1 text-micro text-ink-ghost">muted</span>}
              </a>
              <form action={setSenderMuted}>
                <input type="hidden" name="senderId" value={sender.id} />
                <input type="hidden" name="muted" value={sender.muted ? 'false' : 'true'} />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  aria-label={
                    sender.muted
                      ? `Unmute ${senderLabel(sender)}`
                      : `Mute ${senderLabel(sender)}`
                  }
                >
                  <BellOff
                    className={cn('size-3.5', sender.muted ? 'text-accent' : 'text-ink-ghost')}
                    strokeWidth={1.75}
                  />
                </Button>
              </form>
            </div>
          ))}
        </nav>

        <div>
          <p className="mb-3 text-body text-ink-muted">{countLabel(shown.length)}</p>

          {shown.length === 0 ? (
            <EmptyState
              icon={Mail}
              title={selected ? 'Nothing from them yet' : 'Every sender is muted'}
              description={
                selected
                  ? 'This sender has written to you before, but nothing of theirs is here now.'
                  : 'Everything that has arrived is from a sender you have muted. Unmute one in the column, or pick it to read what it sent.'
              }
              action={selected ? { label: 'Show everything', href: '/news' } : undefined}
            />
          ) : (
            <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
              {shown.map((issue) => {
                const sender = byId.get(issue.senderId);
                return (
                  <li key={issue.id} className="flex items-baseline gap-3 px-4 py-3">
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        issue.readAt ? 'bg-transparent' : 'bg-accent',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-body text-ink',
                          issue.readAt ? '' : 'font-medium',
                        )}
                      >
                        {issue.subject ?? 'No subject'}
                        {!issue.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-ui text-ink-muted">
                        {sender ? senderLabel(sender) : 'Unknown sender'}
                      </span>
                    </span>
                    <span className="shrink-0 text-ui text-ink-muted">
                      {formatArrival(issue.receivedAt, settings.timezone)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

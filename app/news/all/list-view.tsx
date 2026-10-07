import Link from 'next/link';
import { BellOff, Mail } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { segmentedFrame } from '@/components/ui/segmented';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips, type FilterChip } from '@/components/shell/filter-chips';
import { TopicChips } from '@/components/news/topic-chips';
import { topicHrefs } from '@/lib/news/topic-hrefs';
import { cn } from '@/lib/cn';
import {
  countLabel,
  formatArrival,
  listHref,
  newsletterRows,
  readListView,
  senderLabel,
  type ListView,
  type NewsIssue,
  type NewsSender,
  sortSenders,
  type UnreadStories,
  unreadTopics,
  visibleIssues,
} from '@/lib/news/issues/list';
import type { NewsTopic } from '@/lib/news/issues/topics';
import type { DeliveryGap } from '@/lib/news/inbound/readiness';
import { setSenderMuted } from '../actions';

/**
 * The newsletter list, drawn from what the page read (app/news/all/page.tsx),
 * so the gallery can draw it from fixtures (plan #1603). Everything below is
 * the page as it was; the page now only reads.
 */
export function NewsListView({
  timezone,
  senders,
  issues,
  unread,
  from,
  topic,
  viewParam,
  gap,
}: {
  timezone: string;
  senders: NewsSender[];
  issues: NewsIssue[];
  unread: UnreadStories[];
  from: string | undefined;
  topic: NewsTopic | null;
  viewParam: string | undefined;
  /** What is missing for mail to arrive (deliveryGap), or null when nothing is. */
  gap: DeliveryGap;
}) {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const selected = from && byId.has(from) ? from : null;
  // One sender's editions are the Latest view narrowed to them, so a picked
  // sender always reads as Latest.
  const view = selected ? 'latest' : readListView(viewParam);
  const shown = visibleIssues(issues, senders, selected);
  const column = sortSenders(senders);
  const topics = unreadTopics(unread, senders, selected);
  // The topic in force is shown by its own chip row below, so only the sender is here.
  const filters: FilterChip[] = [];
  if (selected) {
    filters.push({
      label: 'From',
      value: senderLabel(byId.get(selected)!),
      clearHref: listHref({ from: null, topic }),
    });
  }

  if (issues.length === 0 && !topic) {
    /**
     * Empty has two meanings and they must not read alike. Nothing has been
     * sent yet is a waiting room. Nothing *can* be received is a broken
     * deployment, and saying "sign a newsletter up and it lands here" to
     * somebody whose mail is being refused is how two subscriptions and a
     * test message get lost before anyone looks at a log.
     */
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Newsletters"
          description="What has been sent to the address that belongs to this app."
        />
        <EmptyState
          icon={Mail}
          title={gap ? 'Nothing can arrive yet' : 'Nothing has arrived yet'}
          description={
            gap
              ? 'This deployment is not finished being set up to receive mail, so anything sent to your address is turned away rather than kept. News settings says which part is missing.'
              : 'Sign a newsletter up with the address in News settings and every issue it sends lands here, including the mail it sends to confirm you meant it.'
          }
          action={{
            label: gap ? 'What is missing' : 'Show me my address',
            href: '/news/settings',
          }}
          secondaryAction={{
            label: 'Newsletters to sign up to',
            href: listHref({ from: null, topic: null, view: 'recommended' }),
          }}
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

      <ViewSwitch view={view} topic={topic} />

      <FilterChips chips={filters} clearAllHref="/news/all" />
      <TopicChips
        topics={topics}
        selected={topic}
        hrefs={topicHrefs(topics, (t) => listHref({ from: selected, topic: t, view }))}
        allHref={listHref({ from: selected, topic: null, view })}
        // A chip is a link, so it takes its phone press area from here.
        className="mb-4 [&_a]:press-area"
      />

      {view === 'newsletters' ? (
        <NewsletterList
          rows={newsletterRows(issues, senders)}
          topic={topic}
          timezone={timezone}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
          <nav aria-label="Filter by sender" className="min-w-0 space-y-1">
            {column.map((sender) => (
              <div key={sender.id} className="flex items-center gap-1">
                <a
                  href={listHref({ from: selected === sender.id ? null : sender.id, topic })}
                  aria-current={selected === sender.id ? 'true' : undefined}
                  className={cn(
                    'press-area min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-ui transition-colors duration-quick hover:bg-canvas',
                    selected === sender.id
                      ? 'bg-accent-tint font-medium text-ink'
                      : 'text-ink-muted',
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
                      sender.muted ? `Unmute ${senderLabel(sender)}` : `Mute ${senderLabel(sender)}`
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
                title={
                  topic
                    ? `Nothing on ${topic}`
                    : selected
                      ? 'Nothing from them yet'
                      : 'Every sender is muted'
                }
                description={
                  topic
                    ? 'No newsletter here has a story on this topic.'
                    : selected
                      ? 'This sender has written to you before, but nothing of theirs is here now.'
                      : 'Everything that has arrived is from a sender you have muted. Unmute one in the column, or pick it to read what it sent.'
                }
                action={
                  topic
                    ? { label: 'Show every topic', href: listHref({ from: selected, topic: null }) }
                    : selected
                      ? { label: 'Show everything', href: '/news/all' }
                      : undefined
                }
              />
            ) : (
              <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
                {shown.map((issue) => {
                  const sender = byId.get(issue.senderId);
                  return (
                    <li key={issue.id}>
                      <Link
                        // Which list this was opened from, carried so that back
                        // comes back to it. An issue knows its sender and
                        // cannot know whether you were filtered to them, so the
                        // list is the only thing that can say -- note 71889d79.
                        href={
                          selected ? `/news/i/${issue.id}?from=${selected}` : `/news/i/${issue.id}`
                        }
                        className="flex items-baseline gap-3 px-4 py-3 transition-colors duration-quick hover:bg-canvas"
                      >
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
                              'relative block truncate text-body text-ink',
                              issue.readAt ? '' : 'font-medium',
                            )}
                          >
                            {issue.subject ?? 'No subject'}
                            {!issue.readAt && <span className="sr-only"> (unread)</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-ui text-ink-muted">
                            {sender ? senderLabel(sender) : 'Unknown sender'}
                          </span>
                          {issue.summaryLine && (
                            <span className="mt-0.5 block truncate text-ui text-ink-muted">
                              {issue.summaryLine}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-ui text-ink-muted">
                          {formatArrival(issue.receivedAt, timezone)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One row per newsletter, the one that wrote last first. A row opens the
 * Latest view narrowed to that sender, which is every edition it sent, newest
 * first (note 20a58f93).
 */
function NewsletterList({
  rows,
  topic,
  timezone,
}: {
  rows: ReturnType<typeof newsletterRows>;
  topic: NewsTopic | null;
  timezone: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title={topic ? `Nothing on ${topic}` : 'Nothing has arrived yet'}
        description="No newsletter here has sent anything that matches."
        action={
          topic
            ? {
                label: 'Show every topic',
                href: listHref({ from: null, topic: null, view: 'newsletters' }),
              }
            : undefined
        }
      />
    );
  }

  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {rows.map(({ sender, editions, unread, latest }) => (
        <li key={sender.id}>
          <Link
            href={listHref({ from: sender.id, topic })}
            className="flex items-baseline gap-3 px-4 py-3 transition-colors duration-quick hover:bg-canvas"
          >
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                unread > 0 ? 'bg-accent' : 'bg-transparent',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn('relative block truncate text-body text-ink', unread > 0 && 'font-medium')}
              >
                {senderLabel(sender)}
                {sender.muted && <span className="ml-1 text-micro text-ink-ghost">muted</span>}
              </span>
              <span className="mt-0.5 block truncate text-ui text-ink-muted">
                {latest.subject ?? 'No subject'}
              </span>
            </span>
            <span className="shrink-0 text-right text-ui text-ink-muted">
              <span className="block tabular-nums">
                {editions} {editions === 1 ? 'edition' : 'editions'}
                {unread > 0 && `, ${unread} unread`}
              </span>
              <span className="block">{formatArrival(latest.receivedAt, timezone)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const VIEWS = [
  { key: 'latest', label: 'Latest' },
  { key: 'newsletters', label: 'By newsletter' },
  { key: 'recommended', label: 'Recommended' },
] as const satisfies readonly { key: ListView; label: string }[];

export function ViewSwitch({ view, topic }: { view: ListView; topic: NewsTopic | null }) {
  return (
    <span role="group" aria-label="How the list is read" className={segmentedFrame}>
      {VIEWS.map((option) => (
        <Link
          key={option.key}
          // The topic narrows the two lists; the recommendations are for every topic.
          href={listHref({
            from: null,
            topic: option.key === 'recommended' ? null : topic,
            view: option.key,
          })}
          scroll={false}
          aria-current={view === option.key ? 'true' : undefined}
          className={cn(
            'press inline-flex h-(--control-h) items-center px-2.5 text-ui font-medium',
            'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
            view === option.key
              ? 'bg-accent-tint text-accent'
              : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
          )}
        >
          {option.label}
        </Link>
      ))}
    </span>
  );
}

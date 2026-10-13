import Link from '@/components/ui/link';
import { BellOff, Mail } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
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
  type UnreadStories,
  unreadTopics,
  type WaitingSignup,
  visibleIssues,
} from '@/lib/news/issues/list';
import type { NewsTopic } from '@/lib/news/issues/topics';
import type { DeliveryGap } from '@/lib/news/inbound/readiness';
import { setSenderMuted } from '../actions';
import { NeedsConfirming } from './needs-confirming';

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
  waiting,
  from,
  topic,
  viewParam,
  gap,
}: {
  timezone: string;
  senders: NewsSender[];
  issues: NewsIssue[];
  unread: UnreadStories[];
  /** Signup emails still waiting for their Confirm press (plan #1725). */
  waiting: readonly WaitingSignup[];
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
        <PageHeader title="Newsletters" />
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

  const header = <PageHeader title="Newsletters" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {header}

      <NeedsConfirming signups={waiting} senders={byId} timezone={timezone} />

      <div className="space-y-3">
        <ViewSwitch view={view} topic={topic} />
        <FilterChips chips={filters} clearAllHref="/news/all" />
        <TopicChips
          topics={topics}
          selected={topic}
          hrefs={topicHrefs(topics, (t) => listHref({ from: selected, topic: t, view }))}
          allHref={listHref({ from: selected, topic: null, view })}
          // A chip is a link, so it takes its phone press area from here.
          className="[&_a]:press-area"
        />
      </div>

      {view === 'newsletters' ? (
        <NewsletterList
          rows={newsletterRows(issues, senders)}
          topic={topic}
          timezone={timezone}
        />
      ) : shown.length === 0 ? (
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
                : 'Everything that has arrived is from a sender you have muted. Unmute one under By newsletter, or pick it there to read what it sent.'
          }
          action={
            topic
              ? { label: 'Show every topic', href: listHref({ from: selected, topic: null }) }
              : selected
                ? { label: 'Show everything', href: '/news/all' }
                : { label: 'By newsletter', href: listHref({ from: null, topic: null, view: 'newsletters' }) }
          }
        />
      ) : (
        <div>
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
                    href={selected ? `/news/i/${issue.id}?from=${selected}` : `/news/i/${issue.id}`}
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
                      {/* The headline has the row's width and two lines for
                          itself; the date sits on the sender's line. */}
                      <span
                        className={cn(
                          'relative block line-clamp-2 text-body text-ink [overflow-wrap:anywhere]',
                          issue.readAt ? '' : 'font-medium',
                        )}
                      >
                        {issue.subject ?? 'No subject'}
                        {!issue.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="mt-0.5 flex items-baseline gap-3 text-ui text-ink-muted">
                        <span className="min-w-0 flex-1 truncate">
                          {sender ? senderLabel(sender) : 'Unknown sender'}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatArrival(issue.receivedAt, timezone)}
                        </span>
                      </span>
                      {issue.summaryLine && (
                        <span className="mt-0.5 block truncate text-ui text-ink-muted">
                          {issue.summaryLine}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-small text-ink-muted">{countLabel(shown.length)}</p>
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
    <div>
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {rows.map(({ sender, editions, unread, latest }) => (
          <li key={sender.id} className="flex items-center">
            <Link
              href={listHref({ from: sender.id, topic })}
              className="flex min-w-0 flex-1 items-baseline gap-3 py-3 pl-4 transition-colors duration-quick hover:bg-canvas"
            >
              <span
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  unread > 0 ? 'bg-accent' : 'bg-transparent',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-3">
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-body text-ink',
                      unread > 0 && 'font-medium',
                    )}
                  >
                    {senderLabel(sender)}
                    {sender.muted && <span className="ml-1 text-micro text-ink-ghost">muted</span>}
                  </span>
                  <span className="shrink-0 text-ui text-ink-muted tabular-nums">
                    {formatArrival(latest.receivedAt, timezone)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-ui text-ink-muted">
                  {latest.subject ?? 'No subject'}
                </span>
                <span className="mt-0.5 block text-ui text-ink-muted tabular-nums">
                  {editions} {editions === 1 ? 'edition' : 'editions'}
                  {unread > 0 && `, ${unread} unread`}
                </span>
              </span>
            </Link>
            {/* Muting lives on the newsletter's own row: it takes its issues
                out of Latest, and the row stays here to bring them back. */}
            <form action={setSenderMuted} className="shrink-0 pr-2 pl-1">
              <input type="hidden" name="senderId" value={sender.id} />
              <input type="hidden" name="muted" value={sender.muted ? 'false' : 'true'} />
              <Tooltip label={sender.muted ? 'Bring this newsletter back into Latest' : 'Keep this newsletter out of Latest'} align="end">
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  aria-label={sender.muted ? `Unmute ${senderLabel(sender)}` : `Mute ${senderLabel(sender)}`}
                >
                  <BellOff
                    className={cn('size-3.5', sender.muted ? 'text-accent' : 'text-ink-ghost')}
                    strokeWidth={1.75}
                  />
                </Button>
              </Tooltip>
            </form>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-small text-ink-muted">{countLabel(rows.length)}</p>
    </div>
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
          className={segmentClass(view === option.key)}
        >
          {option.label}
        </Link>
      ))}
    </span>
  );
}

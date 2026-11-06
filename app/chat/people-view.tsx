import { Messaging, MessagingPlaceholder } from '@/components/patterns/messaging';
import { buttonVariants } from '@/components/ui/button';
import Link from '@/components/ui/link';
import { PageColumn } from '@/components/shell/page-width';
import type { PersonRow, SearchHit } from '@/lib/you/chat-threads-model';
import { NEW_MESSAGE_HREF } from '@/lib/you/chat-threads-model';
import type { GroupRow } from '@/lib/you/group-chats-model';
import { PeopleList } from './people-list';

/**
 * Chat's Messages tab (plan #2748.6; #2879.2 renamed it from People and listed
 * only the chats there are), the messaging pattern: everyone you talk
 * to on the left and the open thread on the right. On a phone the list is
 * the page and a thread is a page of its own (app/chat/people/[key]); `/chat`
 * on a laptop opens the newest thread beside the list, as a texting app
 * does, and passes it as `newest` so a phone leaves it hidden.
 *
 * With no chat yet, one card says so and offers New message; with the
 * threads not read, the list's pane says so where its rows would be, and
 * the thread's pane says in one quiet line that threads open there once they
 * can be read, so a laptop is not left with a blank pane.
 */
export function PeopleView({
  rows,
  groups = [],
  failed = false,
  query = null,
  hits = null,
  current = null,
  timezone,
  now,
  live = true,
  newest = false,
  adding = false,
  children,
}: {
  rows: readonly PersonRow[];
  /** Group chats (plan #2879.1.3), listed with the direct ones. */
  groups?: readonly GroupRow[];
  failed?: boolean;
  query?: string | null;
  hits?: readonly SearchHit[] | null;
  /** The key of the open thread. */
  current?: string | null;
  timezone: string;
  now: number;
  live?: boolean;
  /** The thread is the newest, opened beside the list on a laptop only. */
  newest?: boolean;
  /** A pane is open in the thread's place (the form for adding someone, or New message), even with no chats yet. */
  adding?: boolean;
  /** The open thread, when one is. */
  children?: React.ReactNode;
}) {
  if (!failed && rows.length === 0 && groups.length === 0 && !adding) {
    // Nobody to talk to: one card with the way to the Council, and no empty thread pane beside it.
    return (
      <PageColumn>
        <section className="sheet rounded-card bg-surface px-4 py-4">
          <h2 className="font-display text-title font-semibold tracking-tight text-ink">Messages</h2>
          <p className="mt-4 text-body font-semibold text-ink">No messages yet</p>
          <p className="mt-1 text-ui text-ink-muted">Start a chat with someone you talk to, and it shows here.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={NEW_MESSAGE_HREF} className={buttonVariants({ variant: 'primary' })}>
              New message
            </Link>
            <Link href="/you/council" className={buttonVariants({ variant: 'secondary' })}>
              Open the Council
            </Link>
          </div>
        </section>
      </PageColumn>
    );
  }
  if (failed) {
    return (
      <Messaging
        label="Messages"
        open={false}
        list={
          <div className="flex flex-col px-4 pt-4 pb-4">
            <h2 className="font-display text-title font-semibold tracking-tight text-ink">Messages</h2>
            <p className="mt-3 text-ui text-danger">Your threads could not be read. Reload to try again.</p>
          </div>
        }
      >
        <MessagingPlaceholder>
          <p className="text-ui text-ink-muted">Your threads open here once they can be read.</p>
        </MessagingPlaceholder>
      </Messaging>
    );
  }
  return (
    <Messaging
      label="Messages"
      open={Boolean(children) && !newest}
      list={<PeopleList rows={rows} groups={groups} current={current} currentWide={newest} query={query} hits={hits} timezone={timezone} now={now} live={live} />}
    >
      {children ?? (
        <MessagingPlaceholder>
          <p className="text-body font-medium text-ink">Choose a chat to open it here.</p>
        </MessagingPlaceholder>
      )}
    </Messaging>
  );
}

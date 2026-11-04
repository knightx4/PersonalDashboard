import { Messaging, MessagingPlaceholder } from '@/components/patterns/messaging';
import { buttonVariants } from '@/components/ui/button';
import Link from '@/components/ui/link';
import { PageColumn } from '@/components/shell/page-width';
import { cn } from '@/lib/cn';
import type { PersonRow, SearchHit } from '@/lib/you/chat-threads-model';
import { PeopleList } from './people-list';

/**
 * Chat's People tab (plan #2748.6), the messaging pattern: everyone you talk
 * to on the left and the open thread on the right. On a phone the list is
 * the page and a thread is a page of its own (app/chat/people/[key]); `/chat`
 * on a laptop opens the newest thread beside the list, as a texting app
 * does, and passes it as `newest` so a phone leaves it hidden.
 *
 * With no one to talk to, one card says so and links to the Council; with the
 * threads not read, the list's pane says so
 * where its rows would be, and the thread's pane stays empty beside it.
 */
export function PeopleView({
  rows,
  failed = false,
  query = null,
  hits = null,
  current = null,
  timezone,
  now,
  live = true,
  newest = false,
  children,
}: {
  rows: readonly PersonRow[];
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
  /** The open thread, when one is. */
  children?: React.ReactNode;
}) {
  if (!failed && rows.length === 0) {
    // Nobody to talk to: one card with the way to the Council, and no empty thread pane beside it.
    return (
      <PageColumn>
        <section className="sheet rounded-card bg-surface px-4 py-4">
          <h2 className="font-display text-title font-semibold tracking-tight text-ink">People</h2>
          <p className="mt-4 text-body font-semibold text-ink">No one to talk to yet</p>
          <p className="mt-1 text-ui text-ink-muted">Put mentors on your council and each one gets a thread here.</p>
          <Link href="/you/council" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-3')}>
            Open the Council
          </Link>
        </section>
      </PageColumn>
    );
  }
  if (failed) {
    return (
      <Messaging
        label="People"
        open={false}
        list={
          <div className="flex flex-col px-4 pt-4 pb-4">
            <h2 className="font-display text-title font-semibold tracking-tight text-ink">People</h2>
            <p className="mt-3 text-ui text-danger">Your threads could not be read. Reload to try again.</p>
          </div>
        }
      >
        <MessagingPlaceholder>{null}</MessagingPlaceholder>
      </Messaging>
    );
  }
  return (
    <Messaging
      label="People"
      open={Boolean(children) && !newest}
      list={<PeopleList rows={rows} current={current} currentWide={newest} query={query} hits={hits} timezone={timezone} now={now} live={live} />}
    >
      {children ?? (
        <MessagingPlaceholder>
          <p className="text-body font-medium text-ink">Choose someone to open your thread with them.</p>
        </MessagingPlaceholder>
      )}
    </Messaging>
  );
}

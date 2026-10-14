import { InboxPage, type InboxRow } from '@/components/inbox/inbox-page';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Banner } from '@/components/ui/banner';
import Link from '@/components/ui/link';
import type { AgendaInbox } from '@/lib/todo/agenda/workspace';

/**
 * A workspace's Inbox page (plan #1937.5): the one Inbox component under the
 * page's heading, with anything that could not be read said above it.
 * Drawn the same by the six pages and their gallery surfaces.
 */

/** What each Inbox says when nothing is on you. */
export const WORKSPACE_INBOX_EMPTY: Record<AgendaInbox, { title: string; description: string }> = {
  shopping: {
    title: 'Nothing in Shopping needs you',
    description: 'Return windows, deliveries, bills and the mail sync’s guesses show here when they do.',
  },
  jobs: {
    title: 'Nothing in the job search needs you',
    description: 'Follow-ups, replies you owe and imports to check show here when they do.',
  },
  todo: {
    title: 'Nothing without a date is on you',
    description: 'A todo with no day lands here. Anything with a day is on the agenda.',
  },
  vault: {
    title: 'Nothing in the vault needs you',
    description: 'Quick notes waiting to be filed, and Dash’s questions on your notes, show here.',
  },
  learn: {
    title: 'Nothing in Learn needs you',
    description: 'Readings you queue and Dash’s questions on what you are learning show here.',
  },
  news: {
    title: 'Nothing in News needs you',
    description: 'Dash’s questions on stories and newsletters show here.',
  },
};

export function WorkspaceInbox({
  workspace,
  rows,
  failed = [],
}: {
  workspace: AgendaInbox;
  rows: readonly InboxRow[];
  /** What could not be read just now, named so a short list is not taken for a quiet one. */
  failed?: readonly string[];
}) {
  return (
    <PageColumn className="space-y-6">
      <PageHeader title="Inbox" />
      {failed.length > 0 && (
        <Banner tone="bad">
          {failed.join(' and ')} could not be read just now, so anything from{' '}
          {failed.length > 1 ? 'them' : 'it'} is missing here.
        </Banner>
      )}
      <InboxPage rows={rows} empty={WORKSPACE_INBOX_EMPTY[workspace]}>
        {/* Todo's other half: what waits on someone else, which is not on you. */}
        {workspace === 'todo' && (
          <p className="text-small text-ink-muted">
            Waiting on someone else? <Link href="/todo/waiting">See Waiting</Link>.
          </p>
        )}
      </InboxPage>
    </PageColumn>
  );
}

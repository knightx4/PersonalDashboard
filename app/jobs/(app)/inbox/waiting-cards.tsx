import type { InboxRow } from '@/components/inbox/inbox-page';
import { waitingEventId } from '@/lib/jobs/today/waiting';
import { WaitingInboxRow } from './waiting-row';

/**
 * The Jobs Inbox's rows, with each request from a company drawn by
 * WaitingInboxRow so it keeps Prepare with Dash (plan #1937.9). Shared by
 * the page and its gallery surface.
 */
export function withWaitingCards(rows: readonly InboxRow[]): InboxRow[] {
  return rows.map((row) =>
    waitingEventId(row.ref) ? { ...row, card: <WaitingInboxRow key={row.ref} row={row} /> } : row,
  );
}

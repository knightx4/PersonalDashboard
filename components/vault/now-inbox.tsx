import { InboxPage, type InboxRow } from '@/components/inbox/inbox-page';
import { WORKSPACE_INBOX_EMPTY } from '@/components/inbox/workspace-inbox';
import { Banner } from '@/components/ui/banner';

/**
 * The Vault's Inbox, on its Now page (plan #1496.9): what in the vault is on
 * you, above the quick notes. Nobody opened the Inbox as a page of its own,
 * so it folded in here, and /vault/inbox opens this page at it.
 *
 * Drawn only when there is something to show. The quick notes waiting to be
 * filed are not among the rows: the triage deck under them lists those one
 * by one (lib/inbox/workspace-inbox.ts, LISTED_ON_THEIR_INBOX).
 */
export function VaultNowInbox({
  rows,
  failed = [],
}: {
  rows: readonly InboxRow[];
  /** What could not be read just now, named so a quiet page is not taken for an empty one. */
  failed?: readonly string[];
}) {
  if (rows.length === 0 && failed.length === 0) return null;
  return (
    <section id="inbox" aria-label="On you" className="mb-6 scroll-mt-4 space-y-4">
      {failed.length > 0 && (
        <Banner tone="bad">
          {failed.join(' and ')} could not be read just now, so anything from{' '}
          {failed.length > 1 ? 'them' : 'it'} is missing here.
        </Banner>
      )}
      {rows.length > 0 && <InboxPage rows={rows} empty={WORKSPACE_INBOX_EMPTY.vault} countLine={false} />}
    </section>
  );
}

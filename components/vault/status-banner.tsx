import Link from 'next/link';
import { Banner } from '@/components/ui/banner';
import type { VaultConnectionSummary } from '@/lib/vault/notes/load';

/**
 * When the mirror is not what it looks like.
 *
 * A vault that quietly stopped syncing is the failure worth engineering
 * against: the list still renders, the notes are all there, and everything
 * written in the last six weeks is silently missing. So the two states where
 * "these are your notes" is not quite true say so, above the notes.
 *
 * Both are the shared `Banner`. What was here before was that component's base
 * string typed out again -- the same `flex items-start gap-2.5 rounded-card
 * border px-4 py-3`, the same tint tokens, the same glyph sizes -- which is
 * how a fourth theme reaches a banner nobody remembered was one. The tones say
 * what the copy says: an expired token is `warn`, something only you can fix;
 * a backfill still running is `info`, something happening that you did not
 * start and need not act on. The running one loses its spinner to the
 * primitive's glyph, which is the trade for having one banner: it was not a
 * live indicator anyway -- the page has to be reloaded to change it -- and
 * "the first sync is still working through the vault" already says it.
 */
export function VaultStatusBanner({ connection }: { connection: VaultConnectionSummary }) {
  if (connection.status === 'needs_reauth') {
    return (
      <Banner tone="warn" className="mb-5">
        The access token has expired, so nothing has synced since{' '}
        {connection.lastSyncedAt ? formatDay(connection.lastSyncedAt) : 'it was connected'}.{' '}
        <Link href="/vault/settings" className="font-medium text-accent underline">
          Reconnect the vault
        </Link>{' '}
        to pick it back up. Fine-grained tokens expire; this is normal.
      </Banner>
    );
  }

  if (!connection.backfillCompletedAt) {
    return (
      <Banner tone="info" className="mb-5">
        The first sync is still working through the vault, so this list is incomplete. It
        continues on each scheduled run and needs nothing from you.
      </Banner>
    );
  }

  return null;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

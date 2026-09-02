import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { VaultConnectionSummary } from '@/lib/vault/notes/load';

/**
 * When the mirror is not what it looks like.
 *
 * A vault that quietly stopped syncing is the failure worth engineering
 * against: the list still renders, the notes are all there, and everything
 * written in the last six weeks is silently missing. So the two states where
 * "these are your notes" is not quite true say so, above the notes.
 */
export function VaultStatusBanner({ connection }: { connection: VaultConnectionSummary }) {
  if (connection.status === 'needs_reauth') {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-card border border-border bg-accent-orange-tint px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-orange" strokeWidth={2} aria-hidden />
        <p className="text-sm text-ink">
          The access token has expired, so nothing has synced since{' '}
          {connection.lastSyncedAt ? formatDay(connection.lastSyncedAt) : 'it was connected'}.{' '}
          <Link href="/vault/settings" className="font-medium text-brand underline">
            Reconnect the vault
          </Link>{' '}
          to pick it back up. Fine-grained tokens expire; this is normal.
        </p>
      </div>
    );
  }

  if (!connection.backfillCompletedAt) {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-card border border-border bg-brand-tint px-4 py-3">
        <Loader2 className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden />
        <p className="text-sm text-ink">
          The first sync is still working through the vault, so this list is incomplete. It
          continues on each scheduled run and needs nothing from you.
        </p>
      </div>
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

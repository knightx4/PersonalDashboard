'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/jobs/applications/load';
import { SyncProgressBar, useInboxSync } from '@/components/jobs/inbox/sync-run';

export type CheckableAccount = {
  id: string;
  emailAddress: string;
  status: string;
  lastSyncedAt: string | null;
  /** Null until the first full scan has finished, which Settings runs. */
  backfillCompletedAt: string | null;
};

/**
 * Check the inbox now, from the page that says what checking found.
 *
 * The button lived in Settings, which is a page you open to change something.
 * This is the page you are on when you are waiting for a reply and want to
 * know whether it has landed -- so the scan belongs here too, and this is the
 * copy of it that gets used.
 *
 * Only accounts past their first scan get a button. The first scan is a long
 * job with its own resume behaviour and its own explanation, and both live in
 * Settings; offering it from here would be offering half of it.
 */
export function CheckInboxNow({ accounts }: { accounts: readonly CheckableAccount[] }) {
  const { busy, note, jobs, startSync } = useInboxSync();

  const ready = accounts.filter((account) => account.backfillCompletedAt);
  if (ready.length === 0) return null;

  return (
    <div className="mb-5 space-y-3">
      {ready.map((account) => (
        <div key={account.id}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              size="sm"
              disabled={busy === account.id}
              onClick={() => startSync(account.id, 'incremental')}
            >
              <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
              Check now
            </Button>
            {/* The address only where there is more than one, so a single
                inbox does not have its own name read back to it. */}
            {ready.length > 1 && (
              <span className="text-small text-ink-muted">{account.emailAddress}</span>
            )}
            <span className="tabular text-small text-ink-muted">
              last checked {formatDate(account.lastSyncedAt)}
            </span>
          </div>
          {jobs[account.id] && <SyncProgressBar accountId={account.id} job={jobs[account.id]} />}
        </div>
      ))}
      {note && <p className="text-small text-status-rejected">{note}</p>}
    </div>
  );
}

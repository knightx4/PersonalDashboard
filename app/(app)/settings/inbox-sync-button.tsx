'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export type InboxSyncProgress = {
  jobId: string;
  status?: string;
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  ordersCreated: number;
  skipped: number;
  errors: number;
  done: boolean;
  error?: string;
  alreadyRunning?: boolean;
};

export function InboxSyncButton({
  accountId,
  initialJob = null,
}: {
  accountId: string;
  initialJob?: InboxSyncProgress | null;
}) {
  const [progress, setProgress] = useState<InboxSyncProgress | null>(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const active =
    progress != null &&
    !progress.done &&
    (progress.status === 'running' || progress.status === 'queued');

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/inbox/sync?accountId=${encodeURIComponent(accountId)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { job: InboxSyncProgress | null };
    if (data.job) setProgress(data.job);
  }, [accountId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function startSync() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const data = (await res.json()) as InboxSyncProgress & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      setProgress(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || active;

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={startSync}>
        {busy ? 'Importing in background…' : 'Import orders from Gmail'}
      </Button>
      {progress && (
        <p className="text-xs text-ink-muted" aria-live="polite">
          Seen {progress.messagesSeen} · parsed {progress.messagesParsed}
          {progress.messagesClassified
            ? ` · classified ${progress.messagesClassified}`
            : ''}
          {progress.done && !progress.error
            ? ' · done'
            : active
              ? ' · running in background…'
              : ''}
        </p>
      )}
      {(error || progress?.error) && (
        <p className="text-xs text-red-700">{error ?? progress?.error}</p>
      )}
      {active && (
        <p className="text-xs text-ink-faint">
          You can leave this page — import keeps going on the server. Come back anytime to
          check progress.
        </p>
      )}
      {progress?.done &&
        progress.messagesSeen === 0 &&
        !progress.error &&
        !error && (
          <p className="text-xs text-amber-900">
            No matching mail in the last ~180 days. Confirm order emails exist in this Gmail
            account (Primary/Updates), then try again. If you only shop from other addresses,
            connect that inbox instead.
          </p>
        )}
    </div>
  );
}

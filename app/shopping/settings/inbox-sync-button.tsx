'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { reparseInboxOrders, resetInboxImport } from './actions';

export type InboxSyncProgress = {
  jobId: string;
  type?: string;
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
  updatedAt?: string;
};

export function InboxSyncButton({
  accountId,
  initialJob = null,
  backfillCompleted = false,
}: {
  accountId: string;
  initialJob?: InboxSyncProgress | null;
  /** True once the initial Gmail import finished — enables Sync now. */
  backfillCompleted?: boolean;
}) {
  const [progress, setProgress] = useState<InboxSyncProgress | null>(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [reparsing, setReparsing] = useState(false);

  const active =
    progress != null &&
    !progress.done &&
    !progress.error &&
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

  async function startMode(mode: 'backfill' | 'incremental') {
    setError(null);
    setMessage(null);
    if (mode === 'backfill') setStarting(true);
    else setSyncingNow(true);
    try {
      const res = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, mode }),
      });
      const data = (await res.json()) as InboxSyncProgress & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      setProgress(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setStarting(false);
      setSyncingNow(false);
    }
  }

  async function reparseWithLatest() {
    const confirmed = window.confirm(
      'Re-parse already-imported order emails from this inbox with the latest parser? Orders and inventory stay in place — only merchant, items, and totals are refreshed from Gmail.',
    );
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    setReparsing(true);
    try {
      const result = await reparseInboxOrders(accountId);
      if (!result.ok) throw new Error(result.error ?? 'Reparse failed');
      setMessage(
        result.considered === 0
          ? 'Nothing to reparse — all confirmations already use the latest parser.'
          : `Reparsed ${result.updated} of ${result.considered} order email${result.considered === 1 ? '' : 's'}${
              result.errors ? ` · ${result.errors} error${result.errors === 1 ? '' : 's'}` : ''
            }.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reparse failed');
    } finally {
      setReparsing(false);
    }
  }

  async function resetAndRescan() {
    const confirmed = window.confirm(
      'Delete email-imported orders from this inbox and re-scan Gmail from scratch? Manual orders are kept. This cannot be undone.',
    );
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    setResetting(true);
    try {
      const result = await resetInboxImport(accountId);
      if (!result.ok) throw new Error(result.error ?? 'Reset failed');
      setProgress(null);
      await startMode('backfill');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  const busy = starting || syncingNow || resetting || reparsing || active;
  const isIncremental = progress?.type === 'incremental';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => startMode('backfill')}
        >
          {starting || (active && !isIncremental)
            ? 'Importing in background…'
            : 'Import orders from Gmail'}
        </Button>
        {backfillCompleted && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => startMode('incremental')}
          >
            {syncingNow || (active && isIncremental) ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
        {backfillCompleted && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={reparseWithLatest}
          >
            {reparsing ? 'Reparsing…' : 'Re-parse with latest parser'}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={resetAndRescan}>
          {resetting ? 'Resetting…' : 'Reset & re-scan'}
        </Button>
      </div>
      {progress && (
        <p className="text-small text-ink-muted" aria-live="polite">
          {isIncremental ? 'Sync' : 'Import'} — seen {progress.messagesSeen} · parsed{' '}
          {progress.messagesParsed}
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
      {message && (
        <p className="text-small text-ink-muted" aria-live="polite">
          {message}
        </p>
      )}
      {(error || progress?.error) && (
        <p className="text-small text-danger">{error ?? progress?.error}</p>
      )}
      {active && (
        <p className="text-small text-ink-muted">
          You can leave this page — work keeps going on the server. Come back anytime to check
          progress.
        </p>
      )}
      <p className="text-small text-ink-muted">
        Import skips messages it already saw. After the first import, Sync now (or the hourly
        cron) picks up new mail via Gmail history. Use{' '}
        <span className="text-ink-muted">Re-parse with latest parser</span> to refresh existing
        orders in place when we improve extraction — prefer that over{' '}
        <span className="text-ink-muted">Reset &amp; re-scan</span>, which deletes this inbox’s
        email orders and starts over.
      </p>
      {progress?.done &&
        progress.type !== 'incremental' &&
        progress.messagesSeen === 0 &&
        !progress.error &&
        !error && (
          <p className="text-small text-caution">
            No matching mail in the last ~180 days. Confirm order emails exist in this Gmail
            account (Primary/Updates), then try again. If you only shop from other addresses,
            connect that inbox instead.
          </p>
        )}
    </div>
  );
}

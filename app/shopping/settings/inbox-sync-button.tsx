'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/components/ui/link';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { disconnectInbox, reparseInboxOrders, resetInboxImport } from './actions';
import { PaidHint } from '@/components/ui/paid-hint';

const SYNC_HINT = 'app/api/inbox/sync/route.ts#POST';

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

/**
 * One connected inbox: its heading, its one button, its menu, and what a
 * running import says.
 *
 * The button is Sync now once the first import has run, since that is the one
 * used week to week; Import before then, and Reconnect when Google wants
 * consent again. Everything else is in the menu, so an inbox's actions fit on
 * one line at 390 (plan #1788, law 9).
 */
export function InboxControls({
  accountId,
  email,
  status,
  reconnectHref,
  heading,
  children,
  initialJob = null,
  backfillCompleted = false,
}: {
  accountId: string;
  email: string;
  status: string;
  /** Set when the inbox needs consent again and OAuth is configured. */
  reconnectHref?: string;
  /** The address and its status line. */
  heading: ReactNode;
  /** Whose inbox it is, drawn under the heading. */
  children?: ReactNode;
  initialJob?: InboxSyncProgress | null;
  /** True once the initial Gmail import finished — enables Sync now. */
  backfillCompleted?: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<InboxSyncProgress | null>(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const canSync = status === 'active';

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
    if (!canSync) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [refresh, canSync]);

  // When a run ends, re-read the server parts of the page (the inbox's "last
  // synced", the orders it imported) so they show without a reload.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) router.refresh();
    wasActive.current = active;
  }, [active, router]);

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

  // Not destructive -- orders and inventory stay in place, only merchant,
  // items and totals are refreshed -- so it needs no confirm at all.
  async function reparseWithLatest() {
    setError(null);
    setMessage(null);
    setReparsing(true);
    try {
      const result = await reparseInboxOrders(accountId);
      if (!result.ok) throw new Error(result.error ?? 'Reparse failed');
      setMessage(
        result.considered === 0
          ? 'Nothing to reparse: every confirmation already uses the latest parser.'
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

  const menu: ActionMenuItem[] = [];
  if (canSync && backfillCompleted) {
    menu.push(
      {
        id: 'import',
        label: 'Import orders again',
        disabled: busy,
        onSelect: () => void startMode('backfill'),
      },
      {
        id: 'reparse',
        label: 'Re-parse with latest parser',
        disabled: busy,
        onSelect: () => void reparseWithLatest(),
      },
    );
  }
  if (canSync) {
    menu.push({
      id: 'reset',
      label: 'Reset & re-scan',
      destructive: true,
      disabled: busy,
      confirm:
        'Deletes the orders this inbox imported and re-scans Gmail from scratch. Manual orders are kept.',
      onSelect: () => void resetAndRescan(),
    });
  }
  menu.push({
    id: 'disconnect',
    label: 'Disconnect',
    destructive: true,
    formAction: disconnectInbox,
    formFields: { id: accountId },
  });

  let primary: ReactNode = null;
  if (reconnectHref) {
    primary = (
      <Link href={reconnectHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        <RefreshCw className="size-3.5" strokeWidth={1.75} />
        Reconnect
      </Link>
    );
  } else if (canSync && backfillCompleted) {
    primary = (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => startMode('incremental')}
      >
        {syncingNow || (active && isIncremental) ? 'Syncing…' : 'Sync now'}
      </Button>
    );
  } else if (canSync) {
    primary = (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => startMode('backfill')}
      >
        {starting || active ? 'Importing…' : 'Import orders'}
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{heading}</div>
        <div className="flex shrink-0 items-center gap-1">
          {primary}
          {/* Per order email the import reads, which it finds out as it goes. */}
          {canSync && <PaidHint action={SYNC_HINT} what="Cost of reading each order email" />}
          <ActionMenu label={`More for ${email}`} items={menu} />
          {/* Re-parse is in the menu, whose items are words, so its cost sits
              beside the menu. Per order email: how many there are is known
              only once the reparse has looked. */}
          {canSync && backfillCompleted && (
            <PaidHint
              action="app/shopping/settings/actions.ts#reparseInboxOrders"
              what="Cost of re-parsing each order email, from the menu"
            />
          )}
        </div>
      </div>
      {children}
      {progress && (
        <p className="text-small text-ink-muted" aria-live="polite">
          {isIncremental ? 'Sync' : 'Import'}: seen {progress.messagesSeen} · parsed{' '}
          {progress.messagesParsed}
          {progress.messagesClassified ? ` · classified ${progress.messagesClassified}` : ''}
          {progress.done && !progress.error
            ? ' · done'
            : active
              ? ' · running in the background'
              : ''}
        </p>
      )}
      {(reparsing || resetting) && (
        <p className="text-small text-ink-muted" aria-live="polite">
          {reparsing ? 'Reparsing…' : 'Resetting…'}
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
          You can leave this page. The work keeps going on the server.
        </p>
      )}
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

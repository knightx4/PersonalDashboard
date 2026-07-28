'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Progress = {
  jobId: string;
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  ordersCreated: number;
  skipped: number;
  errors: number;
  done: boolean;
  nextPageToken?: string | null;
  query?: string;
  error?: string;
};

const MAX_BATCHES = 40;

export function InboxSyncButton({ accountId }: { accountId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cancelledRef = useRef(false);

  async function runBatch(
    jobId?: string,
    pageToken?: string | null,
  ): Promise<Progress> {
    const res = await fetch('/api/inbox/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        jobId,
        pageToken: pageToken ?? undefined,
        maxMessages: 15,
      }),
    });
    const data = (await res.json()) as Progress & { error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Sync failed');
    return data;
  }

  async function startSync() {
    setError(null);
    setPending(true);
    cancelledRef.current = false;

    let ordersCreated = 0;
    let skipped = 0;
    let errors = 0;

    try {
      let batch = await runBatch();
      ordersCreated += batch.ordersCreated;
      skipped += batch.skipped;
      errors += batch.errors;
      setProgress({ ...batch, ordersCreated, skipped, errors });

      let batches = 1;
      while (
        !batch.done &&
        !batch.error &&
        !cancelledRef.current &&
        batches < MAX_BATCHES
      ) {
        batch = await runBatch(batch.jobId, batch.nextPageToken);
        batches += 1;
        ordersCreated += batch.ordersCreated;
        skipped += batch.skipped;
        errors += batch.errors;
        setProgress({ ...batch, ordersCreated, skipped, errors });
        if (batch.error) break;
      }

      if (!batch.done && !batch.error && batches >= MAX_BATCHES) {
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                done: true,
                error: 'Stopped after many batches — click Import again to continue.',
              }
            : prev,
        );
      } else if (cancelledRef.current && !batch.done) {
        setProgress((prev) => (prev ? { ...prev, done: true } : prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setPending(false);
    }
  }

  function stopSync() {
    cancelledRef.current = true;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={startSync}>
          {pending ? 'Importing…' : 'Import orders from Gmail'}
        </Button>
        {pending && (
          <Button type="button" variant="ghost" size="sm" onClick={stopSync}>
            Stop
          </Button>
        )}
      </div>
      {progress && (
        <p className="text-xs text-ink-muted">
          Seen {progress.messagesSeen} · parsed {progress.messagesParsed} · orders{' '}
          {progress.ordersCreated} · skipped {progress.skipped}
          {progress.errors ? ` · errors ${progress.errors}` : ''}
          {progress.done && !progress.error ? ' · done' : ''}
          {pending && !progress.done ? ' · continuing…' : ''}
        </p>
      )}
      {(error || progress?.error) && (
        <p className="text-xs text-red-700">{error ?? progress?.error}</p>
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

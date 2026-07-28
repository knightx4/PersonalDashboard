'use client';

import { useEffect, useState, useTransition } from 'react';
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
  error?: string;
};

export function InboxSyncButton({
  accountId,
  autoStart = false,
}: {
  accountId: string;
  autoStart?: boolean;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function runBatch(jobId?: string): Promise<Progress> {
    const res = await fetch('/api/inbox/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, jobId, maxMessages: 15 }),
    });
    const data = (await res.json()) as Progress & { error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Sync failed');
    return data;
  }

  function startSync() {
    setError(null);
    startTransition(async () => {
      try {
        let batch = await runBatch();
        setProgress(batch);
        while (!batch.done) {
          batch = await runBatch(batch.jobId);
          setProgress(batch);
          if (batch.error) break;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sync failed');
      }
    });
  }

  useEffect(() => {
    if (autoStart) startSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount when autoStart
  }, [autoStart]);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={startSync}
      >
        {pending ? 'Importing…' : 'Import orders from Gmail'}
      </Button>
      {progress && (
        <p className="text-xs text-ink-muted">
          Seen {progress.messagesSeen} · parsed {progress.messagesParsed} · orders{' '}
          {progress.ordersCreated} · skipped {progress.skipped}
          {progress.errors ? ` · errors ${progress.errors}` : ''}
          {progress.done ? ' · done' : ' · continuing…'}
        </p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

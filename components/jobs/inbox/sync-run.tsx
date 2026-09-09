'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { syncProgress, type SyncPhase } from '@/lib/core/inbox/progress';

/** The shape /api/inbox/sync reports a run in. */
export type SyncJob = {
  jobId: string;
  type?: string;
  status: string;
  phase: SyncPhase | null;
  messagesSeen: number;
  messagesParsed: number;
  messagesTotal: number | null;
  done: boolean;
  error?: string;
};

/** While a run is live, ask how it is going. */
export const SYNC_POLL_MS = 2000;

/**
 * Starting a scan, and watching the one you started.
 *
 * Both places that offer a scan -- the inbox list in Settings and Check now on
 * Activity -- need the same three things: post the run, poll it until it ends,
 * and hold the last state on screen afterwards. Sharing the hook is what keeps
 * "read 4 messages, linked 1" saying the same thing in both.
 */
export function useInboxSync() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, SyncJob>>({});
  const [watching, setWatching] = useState<string | null>(null);

  // Polling stops when the run does. A finished job stays on screen -- "read
  // 4 messages, linked 1" is the answer to "did that do anything", and it is
  // gone the moment you reload, which is the right lifetime for it.
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/inbox/sync?accountId=${encodeURIComponent(watching!)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { job: SyncJob | null };
        if (cancelled || !data.job) return;
        setJobs((current) => ({ ...current, [watching!]: data.job! }));
        if (data.job.done) setWatching(null);
      } catch {
        // A dropped poll is not worth saying anything about; the next one is
        // two seconds away, and the run is unaffected either way.
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), SYNC_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [watching]);

  async function startSync(accountId: string, mode: 'backfill' | 'incremental') {
    setBusy(accountId);
    setNote(null);
    try {
      const response = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, mode }),
      });
      const data = await response.json();
      if (!response.ok) {
        setNote(data.error);
        return;
      }
      // The POST answers with the job row it started, so the bar has something
      // to show before the first poll comes back.
      if (data.jobId) setJobs((current) => ({ ...current, [accountId]: data as SyncJob }));
      setWatching(accountId);
    } catch {
      setNote('Could not start the scan.');
    } finally {
      setBusy(null);
    }
  }

  return { busy, note, setNote, jobs, startSync };
}

/**
 * What the check is doing, while it does it.
 *
 * Check now used to answer with one line -- "Started. Progress appears in the
 * banner at the top." -- and the banner only shows while a job is mid-flight,
 * which a short check is often past by the time the page repaints. So the
 * button read as doing nothing at all. This watches the run it started and
 * says where it is, and stays on screen with the result once it ends.
 */
export function SyncProgressBar({ accountId, job }: { accountId: string; job: SyncJob }) {
  const view = syncProgress({
    status: job.status,
    phase: job.phase,
    messagesSeen: job.messagesSeen,
    messagesParsed: job.messagesParsed,
    messagesTotal: job.messagesTotal,
    error: job.error ?? null,
  });

  return (
    <div className="mt-2" aria-live="polite" data-account={accountId}>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(view.fraction * 100)}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            view.failed ? 'bg-status-rejected' : 'bg-accent',
          )}
          style={{ width: `${Math.round(view.fraction * 100)}%` }}
        />
      </div>
      <p
        className={cn(
          'tabular mt-1.5 text-small',
          view.failed ? 'text-status-rejected' : 'text-ink-muted',
        )}
      >
        {view.detail}
      </p>
    </div>
  );
}

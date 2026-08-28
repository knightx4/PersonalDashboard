'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type JobProgress = {
  jobId: string;
  type?: string;
  status: string;
  messagesSeen: number;
  messagesParsed: number;
  done: boolean;
  error?: string;
};

/**
 * Lightweight poller so Dashboard/Orders stay usable while Gmail sync runs.
 */
export function InboxSyncBanner({
  accountIds,
  initialJob = null,
}: {
  accountIds: string[];
  initialJob?: JobProgress | null;
}) {
  const [job, setJob] = useState<JobProgress | null>(initialJob);
  const idsKey = useMemo(() => accountIds.join(','), [accountIds]);

  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split(',').filter(Boolean);
    let cancelled = false;

    async function poll() {
      for (const accountId of ids) {
        const res = await fetch(`/api/inbox/sync?accountId=${encodeURIComponent(accountId)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { job: JobProgress | null };
        if (cancelled) return;
        if (data.job && !data.job.done) {
          setJob(data.job);
          return;
        }
      }
      if (!cancelled) setJob(null);
    }

    const id = window.setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [idsKey]);

  if (!job || job.done) return null;

  const label = job.type === 'incremental' ? 'Checking Gmail for new orders' : 'Importing from Gmail';

  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-950">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
        <p>
          {label} in the background — seen {job.messagesSeen}, parsed {job.messagesParsed}.
        </p>
        <Link href="/shopping/settings#inboxes" className="underline underline-offset-2">
          View progress
        </Link>
      </div>
    </div>
  );
}

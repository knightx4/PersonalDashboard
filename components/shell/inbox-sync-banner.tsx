'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Banner } from '@/components/ui/banner';

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
    <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
      {/* info, not good: a sync running is something the app is doing, not
          money coming back. The tones are claims, not decoration. */}
      <Banner tone="info" className="flex-wrap items-center justify-between">
        <span className="tabular">
          {label} in the background — seen {job.messagesSeen}, parsed {job.messagesParsed}.
        </span>{' '}
        <Link
          href="/shopping/settings#inboxes"
          className="font-medium text-accent underline underline-offset-2"
        >
          View progress
        </Link>
      </Banner>
    </div>
  );
}

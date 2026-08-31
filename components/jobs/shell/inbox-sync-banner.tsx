'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RESUME_COOLDOWN_MS,
  shouldAutoResume,
  type BackfillState,
} from '@/lib/core/inbox/resume';

type JobProgress = {
  jobId: string;
  type?: string;
  status: string;
  messagesSeen: number;
  messagesParsed: number;
  done: boolean;
  error?: string;
};

type BackfillInfo = BackfillState & { resumable: boolean };

type Attempt = { at: number; seenAt: number; stalled: number };

/**
 * Lightweight poller so the pipeline stays usable while Gmail sync runs.
 *
 * It also keeps the first scan moving. The scan runs as a chain of server
 * invocations that hand off to each other, and the host stops that chain after
 * a handful of hops -- so a mailbox that needs an hour used to stop after three
 * minutes and sit there marked failed, with the settings page still inviting
 * you to start a scan you had already started six times. A fresh request starts
 * a fresh chain, so while any page of the app is open this asks for the next
 * stretch, and keeps asking until the window is read or two attempts in a row
 * come back having read nothing new.
 */
export function InboxSyncBanner({
  accountIds,
  initialJob = null,
}: {
  accountIds: string[];
  initialJob?: JobProgress | null;
}) {
  const [job, setJob] = useState<JobProgress | null>(initialJob);
  const [resuming, setResuming] = useState(false);
  const attempts = useRef(new Map<string, Attempt>());
  const idsKey = useMemo(() => accountIds.join(','), [accountIds]);

  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split(',').filter(Boolean);
    let cancelled = false;

    async function resume(accountId: string, backfill: BackfillInfo) {
      const prior = attempts.current.get(accountId);
      const sinceLast = prior ? Date.now() - prior.at : null;
      // Returning here rather than letting shouldAutoResume say no keeps the
      // stall count on the same clock as the attempts: polling runs every five
      // seconds, and counting a stall each time would exhaust the budget inside
      // one cooldown, while the resume it is judging is still running.
      if (sinceLast !== null && sinceLast < RESUME_COOLDOWN_MS) return;

      const seen = backfill.latestJob?.messagesSeen ?? 0;
      // Nothing new since the last resume this tab sent means asking again is
      // unlikely to help; two of those and it stops asking.
      const stalled = prior && seen <= prior.seenAt ? prior.stalled + 1 : 0;

      if (
        !shouldAutoResume({
          state: backfill,
          stalledAttempts: stalled,
          sinceLastAttemptMs: sinceLast,
        })
      ) {
        if (prior) attempts.current.set(accountId, { ...prior, stalled });
        return;
      }

      attempts.current.set(accountId, { at: Date.now(), seenAt: seen, stalled });
      if (!cancelled) setResuming(true);
      try {
        await fetch('/api/inbox/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, mode: 'backfill' }),
        });
      } catch {
        // The next poll will try again; a failed kick is not worth surfacing.
      }
    }

    async function poll() {
      let live: JobProgress | null = null;

      for (const accountId of ids) {
        const res = await fetch(`/api/inbox/sync?accountId=${encodeURIComponent(accountId)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { job: JobProgress | null; backfill?: BackfillInfo };
        if (cancelled) return;

        if (data.job && !data.job.done && !live) live = data.job;
        if (data.backfill?.resumable) await resume(accountId, data.backfill);
      }

      if (cancelled) return;
      setJob(live);
      if (live) setResuming(false);
    }

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [idsKey]);

  if (!job || job.done) {
    if (!resuming) return null;
    return (
      <Banner>
        <p>Picking your inbox scan back up…</p>
      </Banner>
    );
  }

  const label = job.type === 'incremental' ? 'Checking Gmail for new mail' : 'Scanning your inbox';

  return (
    <Banner>
      <p className="tabular">
        {label} in the background — {job.messagesSeen} seen, {job.messagesParsed} linked.
      </p>
    </Banner>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-brand-tint px-4 py-2 text-[13px] text-ink">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
        {children}
        <Link
          href="/jobs/settings#inboxes"
          className="font-medium text-brand underline underline-offset-2"
        >
          View progress
        </Link>
      </div>
    </div>
  );
}

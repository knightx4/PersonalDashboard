'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** How often a page with a meeting going looks again, and for how long. */
const POLL_MS = 60_000;
const POLL_FOR_MS = 60 * 60_000;

/** Reads the page again every minute while a meeting is queued or running, for an hour at most. */
export function useRefreshWhileRunning(running: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, router]);
}

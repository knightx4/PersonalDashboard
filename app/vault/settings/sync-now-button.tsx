'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** How often the page re-reads its own progress while a run is in flight. */
const POLL_MS = 4_000;

/** Stop eventually, so a run whose row was never finished cannot poll forever. */
const MAX_POLLS = 75;

/**
 * "Sync now."
 *
 * The page said there was nothing to press, which was true of the design and
 * not of the situation: connect a vault in the morning and the first notes
 * appear tomorrow. This starts the same run the cron starts, then watches it
 * -- refreshing the server component every few seconds is enough, because the
 * progress bar beside it already renders from the run log.
 *
 * `active` comes from the server. `justStarted` covers the seconds between the
 * POST returning and the run's row existing, when the server would otherwise
 * say nothing is happening and the watch would stop before it began.
 */
export function SyncNowButton({ active }: { active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [justStarted, setJustStarted] = useState(false);

  useEffect(() => {
    if (!active && !justStarted) return;

    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls >= MAX_POLLS) {
        clearInterval(timer);
        setJustStarted(false);
        return;
      }
      router.refresh();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [active, justStarted, router]);

  // The server no longer reports a run. Give the row a moment to appear before
  // concluding it is over -- a fresh POST has not written it yet.
  useEffect(() => {
    if (active || !justStarted) return;
    const settle = setTimeout(() => setJustStarted(false), POLL_MS * 3);
    return () => clearTimeout(settle);
  }, [active, justStarted]);

  async function start() {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch('/api/vault/sync', { method: 'POST' });
      const data = (await response.json()) as { error?: string };
      if (response.ok) {
        setNote('Started. This page follows along.');
        setJustStarted(true);
        router.refresh();
      } else {
        setNote(data.error ?? 'Could not start a sync.');
      }
    } catch {
      setNote('Could not start a sync.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={start} disabled={busy || active}>
        <RefreshCw
          className={active ? 'size-4 animate-spin' : 'size-4'}
          strokeWidth={1.75}
          aria-hidden
        />
        {active ? 'Syncing…' : busy ? 'Starting…' : 'Sync now'}
      </Button>
      {note && (
        <span role="status" className="text-[12px] text-ink-muted">
          {note}
        </span>
      )}
    </>
  );
}

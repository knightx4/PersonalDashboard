'use client';

import { useTransition } from 'react';
import { SNOOZE_DAYS } from '@/lib/jobs/today/load';
import { completeQuiet, completeWaiting, snoozeQuiet, snoozeWaiting } from './actions';

/**
 * Same two answers as a reminder -- dealt with, or not now -- for the two
 * sections that are not backed by a reminder row: a request already
 * answered, or a pursuit that is not actually going anywhere yet.
 */
function DismissActions({
  onComplete,
  onSnooze,
}: {
  onComplete: () => Promise<{ error: string | null }>;
  onSnooze: () => Promise<{ error: string | null }>;
}) {
  const [busy, startTransition] = useTransition();

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => startTransition(() => void onSnooze())}
        className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
      >
        Later
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => startTransition(() => void onComplete())}
        className="press rounded-lg border border-border bg-canvas px-2 py-0.5 text-[12px] font-medium text-ink disabled:opacity-50"
        title={`Snoozing pushes it ${SNOOZE_DAYS} days`}
      >
        Dismiss
      </button>
    </span>
  );
}

export function WaitingActions({ eventId }: { eventId: string }) {
  return (
    <DismissActions
      onComplete={() => completeWaiting(eventId)}
      onSnooze={() => snoozeWaiting(eventId)}
    />
  );
}

export function QuietActions({ applicationId }: { applicationId: string }) {
  return (
    <DismissActions
      onComplete={() => completeQuiet(applicationId)}
      onSnooze={() => snoozeQuiet(applicationId)}
    />
  );
}

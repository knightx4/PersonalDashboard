'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { SNOOZE_DAYS } from '@/lib/jobs/today/load';
import { completeWaiting, snoozeWaiting } from './actions';

/**
 * Same two answers as a reminder -- dealt with, or not now -- for the one
 * section that is not backed by a reminder row: a request already answered.
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        pending={busy}
        onClick={() => startTransition(() => void onSnooze())}
      >
        Later
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        pending={busy}
        onClick={() => startTransition(() => void onComplete())}
        title={`Snoozing pushes it ${SNOOZE_DAYS} days`}
      >
        Dismiss
      </Button>
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

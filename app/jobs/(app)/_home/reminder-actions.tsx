'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { SNOOZE_DAYS } from '@/lib/jobs/today/load';
import { completeReminder, snoozeReminder } from './actions';

/**
 * Two answers to a nudge: dealt with, or not now.
 *
 * There is deliberately no third. A nudge you can neither finish nor defer is
 * a nudge you learn to look past, which is how a list of them stops working.
 */
export function ReminderActions({ id }: { id: string }) {
  const [busy, startTransition] = useTransition();

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        pending={busy}
        onClick={() => startTransition(() => void snoozeReminder(id))}
      >
        Later
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        pending={busy}
        onClick={() => startTransition(() => void completeReminder(id))}
        title={`Snoozing pushes it ${SNOOZE_DAYS} days`}
      >
        Done
      </Button>
    </span>
  );
}

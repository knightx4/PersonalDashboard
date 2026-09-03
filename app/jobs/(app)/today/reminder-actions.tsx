'use client';

import { useTransition } from 'react';
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
      <button
        type="button"
        disabled={busy}
        onClick={() => startTransition(() => void snoozeReminder(id))}
        className="text-small text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
      >
        Later
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => startTransition(() => void completeReminder(id))}
        className="press rounded-lg border border-border bg-canvas px-2 py-0.5 text-small font-medium text-ink disabled:opacity-50"
        title={`Snoozing pushes it ${SNOOZE_DAYS} days`}
      >
        Done
      </button>
    </span>
  );
}

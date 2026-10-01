'use client';

import { ConfirmStep } from '@/components/ui/confirm-step';
import { stopWatch } from './actions';

/**
 * Stop a watch from its home row (plan #1296). A stopped watch cannot be
 * started again from here, so the press confirms in place.
 */
export function StopWatchButton({ id }: { id: string }) {
  return (
    <ConfirmStep
      // Short, so the armed state fits the price column beside the row.
      prompt="Stop checking this page?"
      confirmLabel="Yes, stop"
      pendingLabel="Stopping…"
      action={stopWatch}
      fields={{ id }}
      className="-mr-2 max-w-44"
    >
      Stop
    </ConfirmStep>
  );
}

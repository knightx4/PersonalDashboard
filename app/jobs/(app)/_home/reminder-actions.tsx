'use client';

import { useTransition } from 'react';
import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';
import { SNOOZE_DAYS } from '@/lib/jobs/today/load';
import { completeReminder, restoreReminder, snoozeReminder } from './actions';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Two answers to a nudge: dealt with, or not now.
 *
 * There is deliberately no third. A nudge you can neither finish nor defer is
 * a nudge you learn to look past, which is how a list of them stops working.
 */
export function ReminderActions({ id }: { id: string }) {
  const [busy, startTransition] = useTransition();
  const toast = useToast();

  function later() {
    startTransition(async () => {
      const result = await snoozeReminder(id);
      if (result.error) return toast({ text: result.error });
      toast({
        text: `Later: back in ${SNOOZE_DAYS} days`,
        undo: async () => void (await restoreReminder(id, result.dueAt ?? null)),
      });
    });
  }

  function done() {
    startTransition(async () => {
      const result = await completeReminder(id);
      if (result.error) return toast({ text: result.error });
      toast({ text: 'Done', undo: async () => void (await restoreReminder(id, null)) });
    });
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <Tooltip label={`Brings it back in ${SNOOZE_DAYS} days`} align="end">
        <CloseButton lifecycle="later" pending={busy} onClick={later} />
      </Tooltip>
      <Tooltip label="Marks the reminder done and takes it off this list" align="end">
        <CloseButton lifecycle="done" variant="secondary" pending={busy} onClick={done} />
      </Tooltip>
    </span>
  );
}

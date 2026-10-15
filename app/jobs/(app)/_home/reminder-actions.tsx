'use client';

import { closedToast } from '@/lib/core/lifecycle';
import { useTransition } from 'react';
import { CloseButton } from '@/components/inbox/close-button';
import { LaterMenu } from '@/components/inbox/snooze-menu';
import { useToast } from '@/components/ui/toast';
import { completeReminder, restoreReminder, snoozeReminder } from './actions';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Two answers to a nudge: dealt with, or not now. Each toast names the
 * nudge it closed (plan #1957.8), and Later is the one Later menu, to the
 * day chosen (plan #1957.9).
 *
 * There is deliberately no third. A nudge you can neither finish nor defer is
 * a nudge you learn to look past, which is how a list of them stops working.
 */
export function ReminderActions({ id, title }: { id: string; title: string }) {
  const [busy, startTransition] = useTransition();
  const toast = useToast();

  function later(choice: string) {
    startTransition(async () => {
      const result = await snoozeReminder(id, choice);
      if (result.error) return toast({ text: result.error });
      toast({
        text: result.until ? `${closedToast('later', title)}, ${result.until}` : closedToast('later', title),
        undo: async () => void (await restoreReminder(id, result.dueAt ?? null)),
      });
    });
  }

  function done() {
    startTransition(async () => {
      const result = await completeReminder(id);
      if (result.error) return toast({ text: result.error });
      toast({ text: closedToast('done', title), undo: async () => void (await restoreReminder(id, null)) });
    });
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <LaterMenu label={title} onChoose={later} />
      <Tooltip label="Marks the reminder done and takes it off this list" align="end">
        <CloseButton lifecycle="done" variant="secondary" pending={busy} onClick={done} />
      </Tooltip>
    </span>
  );
}

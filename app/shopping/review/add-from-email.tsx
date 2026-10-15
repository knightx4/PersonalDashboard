'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { DashAction } from '@/components/ui/dash-action';
import { useToast, type ToastInput } from '@/components/ui/toast';
import { carryToast } from '@/components/shell/capture';
import { makeAimedCapture, undoCaptureBox } from '@/app/capture-actions';

/**
 * "Add from this email" (plan #1950.3.3): reads the waiting confirmation,
 * shipping or delivery email and makes the order from it in this one press,
 * then opens the order. There is no form between; the order's own page is
 * where a line the read got wrong is put right, and Undo in the toast takes
 * the order back, as for any Add.
 *
 * It goes through the aimed capture, so the record, the toast and the page
 * it opens are the ones an Add button on Orders makes.
 */
export function AddFromEmailButton({ messageId, subject }: { messageId: string; subject: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function press() {
    if (pending) return;
    start(async () => {
      const result = await makeAimedCapture({ kind: 'order', text: subject, emailId: messageId });
      if (!result.ok) {
        toast({ text: result.error });
        return;
      }
      const made = result.filed;
      const page = made.page ?? null;
      const actionId = made.actionId;
      const origin = `${window.location.pathname}${window.location.search}`;
      const notice: ToastInput = {
        text: result.errors[0] ?? `Added to ${made.where}.`,
        undone: 'Taken back.',
        ...(actionId
          ? {
              undo: async () => {
                const undone = await undoCaptureBox(actionId);
                if (!undone.ok) throw new Error(undone.error);
                // The order's page has nothing on it now: back to the queue.
                if (page && window.location.pathname === page.split('?')[0]) router.push(origin);
                else router.refresh();
              },
            }
          : {}),
      };
      toast(notice);
      if (page) {
        carryToast(notice);
        router.push(page);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <DashAction
      type="button"
      variant="secondary"
      size="sm"
      onClick={press}
      disabled={pending}
      pending={pending}
      paid="app/capture-actions.ts#makeAimedCapture:email"
      count={1}
      what="Cost of reading the email"
      wrapperClassName="self-center"
    >
      {pending ? 'Reading the email…' : 'Add from this email'}
    </DashAction>
  );
}

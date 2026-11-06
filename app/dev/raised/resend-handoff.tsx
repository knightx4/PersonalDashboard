'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { resendFlaggedHandoff } from './bot-handoff-actions';

/** Resend on a flagged hand-off (plan #3003.4): the same request, passed to the same bot again. */
export function ResendHandoff({ id, to }: { id: string; to: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="shrink-0"
      pending={pending}
      onClick={() =>
        start(async () => {
          const done = await resendFlaggedHandoff(id);
          toast({ text: done.ok ? `Sent to ${to} again.` : 'It was already sent again.' });
        })
      }
    >
      Resend
    </Button>
  );
}

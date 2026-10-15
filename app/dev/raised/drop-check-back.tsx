'use client';

import { closedToast } from '@/lib/core/lifecycle';
import { useTransition } from 'react';
import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';
import { dropCheckBack, restoreCheckBack } from './check-back-actions';

/**
 * Drop on a check-back, with the toast's Undo (plan #1957.3). The glyph alone,
 * so the line's title keeps the width it had on a phone.
 */
export function DropCheckBack({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <CloseButton
      lifecycle="dropped"
      compact
      label={title}
      className="shrink-0"
      pending={pending}
      onClick={() =>
        start(async () => {
          const form = new FormData();
          form.set('id', id);
          await dropCheckBack(form);
          toast({ text: closedToast('dropped', title), undo: () => restoreCheckBack(id) });
        })
      }
    />
  );
}

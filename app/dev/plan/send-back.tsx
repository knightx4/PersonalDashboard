'use client';

import { useActionState, useState } from 'react';
import { ThumbsDown } from 'lucide-react';
import { sendScreenBack, type PlanActionState } from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Label, Textarea } from '@/components/ui/field';

/**
 * The thumbs-down under a changed screen's pictures (plan #1542,
 * docs/UI-QUALITY-SPEC.md Part 6). Closed it is one quiet press; opened it
 * asks what is wrong, and sending reopens the step with your words on it.
 *
 * `open` starts it opened, for the gallery's picture of the form.
 */
export function SendScreenBack({
  id,
  surface,
  open: startOpen = false,
}: {
  id: string;
  surface: string;
  open?: boolean;
}) {
  const [state, action, pending] = useActionState(sendScreenBack, {} as PlanActionState);
  const [open, setOpen] = useState(startOpen);
  const field = `send-back-${id}-${surface}`;

  if (state.message) return <p className="text-small text-ink-muted">{state.message}</p>;

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="-ml-2.5 gap-1.5"
        onClick={() => setOpen(true)}
      >
        <ThumbsDown className="size-4" strokeWidth={2} aria-hidden />
        Send back
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="surface" value={surface} />
      <Label htmlFor={field}>What is wrong with this screen?</Label>
      <Textarea
        id={field}
        name="words"
        rows={2}
        className="min-h-12"
        autoFocus={!startOpen}
        placeholder="The step reopens with this on it, for the next session."
      />
      <div className="flex flex-wrap items-center gap-1">
        <Button type="submit" size="sm" pending={pending}>
          Reopen the step
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

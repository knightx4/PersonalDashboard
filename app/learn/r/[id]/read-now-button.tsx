'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { BookOpen } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { toggleReadNow, type ReadingActionState } from './actions';

/**
 * Put this on the shelf, or take it off.
 *
 * One button rather than a place in the status row: where you are with a
 * reading and whether you mean to read it next are different facts, and a
 * fifth status would have made "Read now" mutually exclusive with "Reading",
 * which is the one combination that happens most.
 */
export function ReadNowButton({ readingId, on }: { readingId: string; on: boolean }) {
  const [state, formAction] = useActionState<ReadingActionState, FormData>(toggleReadNow, {});

  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="readingId" value={readingId} />
      <input type="hidden" name="on" value={on ? 'off' : 'on'} />
      <Submit on={on} />
      {state.error && <p className="text-ui text-danger">{state.error}</p>}
    </form>
  );
}

function Submit({ on }: { on: boolean }) {
  const { pending } = useFormStatus();

  // The secondary button supplies the shape -- the dial's height, the control
  // radius, the press and the focus ring -- and the only thing this adds is
  // what "down" looks like. Hand-drawing the frame is how a toggle ends up
  // 30px beside a 32px button.
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={on}
      className={cn(
        buttonVariants({ variant: 'secondary' }),
        on && 'border-accent bg-accent-tint text-accent hover:border-accent hover:bg-accent-tint',
      )}
    >
      <BookOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
      {on ? 'On Read now' : 'Read now'}
    </button>
  );
}

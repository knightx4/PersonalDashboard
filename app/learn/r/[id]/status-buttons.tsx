'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { updateStatus, type ReadingActionState } from './actions';

/**
 * Where you are with a reading.
 *
 * Four states and one of them is "gave up", which is the only interesting
 * choice here. A queue that can only be completed lies about your progress,
 * and the bar on /learn is worthless the moment it counts six things you
 * abandoned in March as still ahead of you. Saying so costs one click and
 * makes every number downstream true.
 */

const OPTIONS = [
  { value: 'queued', label: 'Not started' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
  { value: 'abandoned', label: 'Gave up' },
] as const;

function Option({
  value,
  label,
  active,
}: {
  value: string;
  label: string;
  active: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="status"
      value={value}
      disabled={pending || active}
      aria-pressed={active}
      // Not Segmented, deliberately: these are submit buttons carrying their
      // own name and value, so the form still works with no JavaScript (law
      // 6), and Segmented is a client control with an onChange. What they do
      // take from the vocabulary is the button's shape, so four status
      // choices are four buttons at the density everything else is at.
      className={cn(
        buttonVariants({ variant: 'secondary' }),
        'disabled:pointer-events-none',
        active && 'border-accent bg-accent-tint text-accent disabled:opacity-100',
        pending && !active && 'opacity-50',
      )}
    >
      {label}
    </button>
  );
}

export function StatusButtons({
  readingId,
  status,
}: {
  readingId: string;
  status: string;
}) {
  const [state, formAction] = useActionState<ReadingActionState, FormData>(updateStatus, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="readingId" value={readingId} />
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Option
            key={option.value}
            value={option.value}
            label={option.label}
            active={option.value === status}
          />
        ))}
      </div>
      {state.error && <p className="mt-2 text-ui text-danger">{state.error}</p>}
    </form>
  );
}

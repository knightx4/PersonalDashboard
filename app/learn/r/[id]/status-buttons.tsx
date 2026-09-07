'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
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
      className={cn(
        'press rounded-lg border px-3 py-1.5 text-ui transition-colors duration-150',
        'disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2',
        active
          ? 'border-accent bg-accent-tint font-medium text-accent'
          : 'border-control bg-surface text-ink hover:bg-sunken',
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

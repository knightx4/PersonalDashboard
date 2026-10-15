'use client';

import Link from '@/components/ui/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { updateStatus, type StatusActionState } from './actions';

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
    <Button
      variant="secondary"
      pressed={active}
      type="submit"
      name="status"
      value={value}
      disabled={pending || active}
      // Not Segmented, deliberately: these are submit buttons carrying their
      // own name and value, so the form still works with no JavaScript (law
      // 6), and Segmented is a client control with an onChange. What they do
      // take from the vocabulary is the button's shape, so four status
      // choices are four buttons at the density everything else is at.
      className={cn(
        'disabled:pointer-events-none',
        active && 'disabled:opacity-100',
        pending && !active && 'opacity-50',
      )}
    >
      {label}
    </Button>
  );
}

export function StatusButtons({
  readingId,
  status,
  offered,
}: {
  readingId: string;
  status: string;
  /** Draws the Check it now prompt as if the reading had just been marked read; the gallery only. */
  offered?: { href: string };
}) {
  const [state, formAction] = useActionState<StatusActionState, FormData>(
    updateStatus,
    offered ? { check: offered } : {},
  );
  const [dismissed, setDismissed] = useState(false);
  const check = status === 'read' && !dismissed ? state.check : undefined;

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
      {check && (
        <div className={cn(cardVariants({ padding: 'dense' }), 'mt-3 flex flex-wrap items-center gap-2')}>
          <p className="w-full text-ui text-ink">Want one question on the idea you read this for?</p>
          <Link href={check.href} className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Check it now
          </Link>
          <Button type="button" variant="secondary" size="md" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        </div>
      )}
    </form>
  );
}

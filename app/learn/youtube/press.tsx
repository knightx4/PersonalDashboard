'use client';

import { useActionState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { PressState } from './actions';

/**
 * A button that runs one library action and says what it did.
 *
 * Transcribing a playlist or re-listing a channel can take a minute, and the
 * list it changes may look the same afterwards, so the line the action
 * returns is shown beside the button until the next press.
 */
export function Press({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'secondary',
  className,
}: {
  action: (state: PressState, formData: FormData) => Promise<PressState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  variant?: ButtonProps['variant'];
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, {});

  return (
    <form action={run} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant} pending={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {state.error ? (
        <span role="alert" className="text-small text-danger">
          {state.error}
        </span>
      ) : state.message ? (
        <span aria-live="polite" className="text-small text-ink-muted">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

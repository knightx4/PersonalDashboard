'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Button, type ButtonProps } from './button';
import { FieldError } from './field';

/**
 * A confirm that happens in place.
 *
 * For the handful of actions that genuinely cannot be undone -- deleting
 * forever, re-scanning an inbox from scratch -- an undo is a lie, so a
 * confirm is right. But it is a second click on the same spot, in the app's
 * own clothes, with the consequence written next to it, not a browser dialog
 * that stops the world. The first click arms it; the second does it; anything
 * else disarms it.
 *
 * Takes either a server action with hidden fields (the common case) or an
 * async callback. Pending state and the error both render here, so the call
 * site is one element.
 */
export function ConfirmStep({
  children,
  prompt,
  confirmLabel,
  pendingLabel = 'Working…',
  action,
  fields,
  onConfirm,
  variant = 'ghost',
  size = 'sm',
  confirmVariant = 'danger',
  align = 'end',
  className,
  disabled,
}: {
  /** The button before it is armed: "Delete forever". */
  children: React.ReactNode;
  /** What will happen, in a sentence, shown once armed. */
  prompt: React.ReactNode;
  /** The armed button: "Yes, delete". Defaults to the trigger's label. */
  confirmLabel?: React.ReactNode;
  pendingLabel?: string;
  action?: (formData: FormData) => Promise<unknown> | unknown;
  fields?: Record<string, string>;
  onConfirm?: () => Promise<void> | void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  confirmVariant?: ButtonProps['variant'];
  align?: 'start' | 'end';
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!armed) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => {
          setError(null);
          setArmed(true);
        }}
      >
        {children}
      </Button>
    );
  }

  function run() {
    start(async () => {
      try {
        if (action) {
          const formData = new FormData();
          for (const [key, value] of Object.entries(fields ?? {})) formData.set(key, value);
          const result = (await action(formData)) as { ok?: boolean; error?: string } | undefined;
          if (result && result.ok === false) {
            setError(result.error ?? 'That did not work.');
            return;
          }
        } else if (onConfirm) {
          await onConfirm();
        }
        setArmed(false);
      } catch (err) {
        const digest =
          typeof err === 'object' && err && 'digest' in err
            ? String((err as { digest: unknown }).digest)
            : '';
        // redirect() from a server action -- let Next navigate.
        if (digest.startsWith('NEXT_REDIRECT')) throw err;
        setError(err instanceof Error ? err.message : 'That did not work.');
      }
    });
  }

  return (
    <div
      className={cn(
        'inline-flex flex-col gap-1.5',
        align === 'end' ? 'items-end text-right' : 'items-start text-left',
        className,
      )}
    >
      <p className="max-w-xs text-small text-ink-muted">{prompt}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size={size}
          disabled={pending}
          onClick={() => setArmed(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant={confirmVariant}
          size={size}
          disabled={pending}
          onClick={run}
          autoFocus
        >
          {pending ? pendingLabel : confirmLabel ?? children}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

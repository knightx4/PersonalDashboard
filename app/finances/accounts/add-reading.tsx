'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { usePopover } from '@/lib/use-popover';
import { addReading } from './actions';

/**
 * Add balance, and the popover it opens (plan #2593.5): a new balance for an
 * account kept by hand, with the day it is from, today unless changed.
 * Saving adds a reading, or replaces that day's, and the page redraws with
 * the new balance and its age.
 *
 * The gallery draws it open with `defaultOpen`, and with an error showing
 * through `error`.
 */
export function AddReading({
  accountId,
  accountName,
  owed,
  today,
  variant = 'secondary',
  anchor = 'trigger-below-end',
  defaultOpen = false,
  balance: givenBalance = '',
  error: givenError = null,
}: {
  accountId: string;
  accountName: string;
  /** A card or a loan: the balance is what is owed. */
  owed: boolean;
  today: string;
  variant?: 'primary' | 'secondary';
  /** Hang from the button's right edge (in a header) or its left (at the start of a banner). */
  anchor?: 'trigger-below-end' | 'trigger-below';
  defaultOpen?: boolean;
  balance?: string;
  error?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [balance, setBalance] = useState(givenBalance);
  const [day, setDay] = useState(today);
  const [error, setError] = useState<string | null>(givenError);
  const [pending, startSaving] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const balanceId = useId();
  const dayId = useId();
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      const result = await addReading(accountId, balance, day);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setBalance('');
      toast({ text: `Saved the balance of ${accountName}.` });
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(!open);
          setError(null);
        }}
        className={buttonVariants({ variant, size: 'sm' })}
      >
        Add balance
      </button>
      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-label={`Add a balance for ${accountName}`}
          anchor={anchor}
          padding="panel"
          className="w-72"
        >
          <form onSubmit={save} className="space-y-3">
            <Field id={balanceId} label={owed ? 'Amount owed' : 'Balance'} error={error}>
              <Input
                id={balanceId}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="tabular"
              />
            </Field>
            <Field id={dayId} label="As of">
              <Input
                id={dayId}
                type="date"
                max={today}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" pending={pending}>
                Save balance
              </Button>
            </div>
          </form>
        </Popover>
      )}
    </div>
  );
}

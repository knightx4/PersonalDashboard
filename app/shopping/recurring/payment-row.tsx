'use client';

import { useActionState, useRef, useState, type ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { InlineInput, Select } from '@/components/ui/field';
import { PAYEE_MAX } from '@/lib/recurring/limits';
import {
  mergeRecurringPayment,
  renameRecurringPayment,
  type RecurringActionState,
} from './actions';

/**
 * One payment on the Recurring page, with the corrections you can make to it
 * (feature #1193). The name is edited in place (law 12) and the row's menu
 * holds the rest; Rename in the menu puts the cursor in the name, for anyone
 * who looks for it there first.
 *
 * Merge into… opens a picker under the row rather than a second menu (menus
 * do not nest): the other payments by name, and the one picked keeps its
 * name and gains this one's charges.
 *
 * The details under the name and the amount are drawn by the server view and
 * passed in, so the page stays presentational for /preview.
 */

export type PaymentChoice = { id: string; payee: string };

const initial: RecurringActionState = {};

export function PaymentRow({
  id,
  payee,
  details,
  amount,
  others,
}: {
  id: string;
  payee: string;
  details: ReactNode;
  amount: ReactNode;
  /** The person's other payments, the ones this one can be merged into. */
  others: readonly PaymentChoice[];
}) {
  const [renameState, rename, renaming] = useActionState(renameRecurringPayment, initial);
  const [mergeState, merge, mergingNow] = useActionState(mergeRecurringPayment, initial);
  const [merging, setMerging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: ActionMenuItem[] = [
    {
      id: 'rename',
      label: 'Rename',
      onSelect: () => {
        // After the menu has closed, or its close takes the focus back.
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      },
    },
    {
      id: 'merge',
      label: 'Merge into…',
      disabled: others.length === 0,
      onSelect: () => setMerging(true),
    },
  ];

  function commit(event: React.FocusEvent<HTMLInputElement>) {
    const value = event.target.value.trim();
    if (value === '') {
      event.target.value = payee;
      return;
    }
    if (value !== payee) event.target.form?.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.currentTarget.value = payee;
      event.currentTarget.blur();
    }
  }

  return (
    <li className="row-pad flex items-start gap-3 px-4">
      <div className="min-w-0 flex-1">
        <form action={rename} className="-mx-1">
          <input type="hidden" name="id" value={id} />
          <InlineInput
            ref={inputRef}
            name="payee"
            required
            maxLength={PAYEE_MAX}
            defaultValue={payee}
            key={payee}
            aria-label={`Rename ${payee}`}
            disabled={renaming}
            onBlur={commit}
            onKeyDown={onKeyDown}
            className="truncate font-medium"
          />
        </form>
        {renameState.error && <p className="text-small text-danger">{renameState.error}</p>}
        {details}
        {merging && (
          <form action={merge} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={id} />
            <label className="block text-ui text-ink-muted" htmlFor={`merge-${id}`}>
              Merge {payee} into
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                id={`merge-${id}`}
                name="into"
                required
                defaultValue=""
                disabled={mergingNow}
                className="max-w-full min-w-0 flex-1"
              >
                <option value="" disabled>
                  Pick a payment
                </option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.payee}
                  </option>
                ))}
              </Select>
              <Button type="submit" pending={mergingNow}>
                Merge
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMerging(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-ui text-ink-muted">
              Its charges move to the payment you pick, which keeps its own name. Mail under either
              name files there from now on.
            </p>
            {mergeState.error && <p className="text-small text-danger">{mergeState.error}</p>}
          </form>
        )}
      </div>
      {amount}
      <ActionMenu label={`${payee} actions`} items={items} />
    </li>
  );
}

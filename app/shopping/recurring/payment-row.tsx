'use client';

import { useActionState, useRef, type ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { InlineInput } from '@/components/ui/field';
import { PAYEE_MAX } from '@/lib/recurring/limits';
import { renameRecurringPayment, type RecurringActionState } from './actions';

/**
 * One payment on the Recurring page, with the corrections you can make to it
 * (feature #1193). The name is edited in place (law 12) and the row's menu
 * holds the rest; Rename in the menu puts the cursor in the name, for anyone
 * who looks for it there first.
 *
 * The details under the name and the amount are drawn by the server view and
 * passed in, so the page stays presentational for /preview.
 */

const initial: RecurringActionState = {};

export function PaymentRow({
  id,
  payee,
  details,
  amount,
}: {
  id: string;
  payee: string;
  details: ReactNode;
  amount: ReactNode;
}) {
  const [renameState, rename, renaming] = useActionState(renameRecurringPayment, initial);
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
      </div>
      {amount}
      <ActionMenu label={`${payee} actions`} items={items} />
    </li>
  );
}

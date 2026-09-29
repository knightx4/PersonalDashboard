'use client';

import { useActionState, useRef, useState, type ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { InlineInput, Input, Select } from '@/components/ui/field';
import { PAYEE_MAX } from '@/lib/recurring/limits';
import {
  mergeRecurringPayment,
  moveRecurringCharges,
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
 * Move charges… opens the row's charges under it (plan #1211): tick one, or
 * every charge at one amount at once, and send them to another payment or to
 * a new one named there. Both payments are worked out again afterwards.
 *
 * The details under the name and the amount are drawn by the server view and
 * passed in, so the page stays presentational for /preview.
 */

export type PaymentChoice = { id: string; payee: string };

/** One charge as the move picker lists it, formatted by the server view. */
export type ChargeChoice = {
  id: string;
  /** "14 Sep · Charge". */
  when: string;
  /** "$3.99", or null when the email named no amount. */
  amount: string | null;
};

const initial: RecurringActionState = {};

export function PaymentRow({
  id,
  payee,
  details,
  amount,
  others,
  charges,
}: {
  id: string;
  payee: string;
  details: ReactNode;
  amount: ReactNode;
  /** The person's other payments, the ones this one can be merged into. */
  others: readonly PaymentChoice[];
  /** Its charges, newest first, the ones that can be moved out of it. */
  charges: readonly ChargeChoice[];
}) {
  const [renameState, rename, renaming] = useActionState(renameRecurringPayment, initial);
  const [mergeState, merge, mergingNow] = useActionState(mergeRecurringPayment, initial);
  const [panel, setPanel] = useState<'merge' | 'move' | null>(null);
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
      onSelect: () => setPanel('merge'),
    },
    {
      id: 'move',
      label: 'Move charges…',
      disabled: charges.length === 0,
      onSelect: () => setPanel('move'),
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
        {panel === 'merge' && (
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
              <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
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
        {panel === 'move' && (
          <MoveCharges
            id={id}
            payee={payee}
            charges={charges}
            others={others}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
      {amount}
      <ActionMenu label={`${payee} actions`} items={items} />
    </li>
  );
}

/**
 * The charges of one payment with a picker for where they go. The amount
 * buttons tick every charge at that amount, which is how an "Apple" row's
 * $3.99 receipts leave it together.
 */
function MoveCharges({
  id,
  payee,
  charges,
  others,
  onClose,
}: {
  id: string;
  payee: string;
  charges: readonly ChargeChoice[];
  others: readonly PaymentChoice[];
  onClose: () => void;
}) {
  // Closed on success: the charges ticked are no longer this row's, and the
  // row itself is gone when it gave up its last one.
  const [state, move, moving] = useActionState(
    async (prev: RecurringActionState, formData: FormData) => {
      const result = await moveRecurringCharges(prev, formData);
      if (!result.error) onClose();
      return result;
    },
    initial,
  );
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [into, setInto] = useState(others.length > 0 ? '' : 'new');

  const amounts = new Map<string, string[]>();
  for (const c of charges) {
    if (c.amount) amounts.set(c.amount, [...(amounts.get(c.amount) ?? []), c.id]);
  }
  const groups = [...amounts].filter(([, ids]) => ids.length > 1 && ids.length < charges.length);

  function toggle(chargeId: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(chargeId);
      else next.delete(chargeId);
      return next;
    });
  }

  return (
    <form action={move} className="mt-2 space-y-2">
      <input type="hidden" name="id" value={id} />
      <fieldset className="space-y-1">
        <legend className="text-ui text-ink-muted">Move charges out of {payee}</legend>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-1">
            {groups.map(([amount, ids]) => (
              <Button
                key={amount}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPicked(new Set(ids))}
              >
                Every {amount} charge ({ids.length})
              </Button>
            ))}
          </div>
        )}
        <ul className="space-y-1">
          {charges.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-ui text-ink">
                <input
                  type="checkbox"
                  name="charge"
                  value={c.id}
                  checked={picked.has(c.id)}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                  disabled={moving}
                  className="size-4 shrink-0 rounded border-border text-accent focus:ring-accent/30"
                />
                <span className="min-w-0 flex-1 truncate">{c.when}</span>
                <span className="tabular shrink-0">{c.amount ?? 'No amount'}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <label className="block text-ui text-ink-muted" htmlFor={`move-${id}`}>
        Move {picked.size === 1 ? 'it' : 'them'} to
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id={`move-${id}`}
          name="into"
          required
          value={into}
          onChange={(e) => setInto(e.target.value)}
          disabled={moving}
          className="max-w-full min-w-0 flex-1"
        >
          <option value="" disabled>
            Pick a payment
          </option>
          <option value="new">A new payment…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.payee}
            </option>
          ))}
        </Select>
        {into === 'new' && (
          <Input
            name="payee"
            required
            maxLength={PAYEE_MAX}
            placeholder="Its name"
            aria-label="Name of the new payment"
            disabled={moving}
            className="max-w-full min-w-0 flex-1"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" pending={moving} disabled={picked.size === 0}>
          {picked.size === 0
            ? 'Move charges'
            : `Move ${picked.size} ${picked.size === 1 ? 'charge' : 'charges'}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="text-ui text-ink-muted">
        Both payments are worked out again from the charges each keeps. A payment left with no
        charges is removed.
      </p>
      {state.error && <p className="text-small text-danger">{state.error}</p>}
    </form>
  );
}

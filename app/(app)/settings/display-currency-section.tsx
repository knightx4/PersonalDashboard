'use client';

import { useFormStatus } from 'react-dom';
import { Label, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { DISPLAY_CURRENCIES } from '@/lib/fx/money-fx';
import { updateDisplayCurrency, type DisplayCurrencyState } from './actions';
import { useActionState } from 'react';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save currency'}
    </Button>
  );
}

export function DisplayCurrencySection({
  displayCurrency,
}: {
  displayCurrency: string;
}) {
  const [state, action] = useActionState<DisplayCurrencyState, FormData>(
    updateDisplayCurrency,
    {},
  );

  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="display_currency">Display currency</Label>
        <Select
          id="display_currency"
          name="display_currency"
          defaultValue={displayCurrency}
          className="mt-1.5 max-w-xs"
        >
          {DISPLAY_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
        <p className="mt-2 text-[13px] text-ink-muted">
          Orders keep the currency they were purchased in. Lists and the dashboard
          convert using the historical rate on each purchase date when available.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton />
        {state.message && (
          <p className="text-[13px] text-positive">{state.message}</p>
        )}
        {state.error && <p className="text-[13px] text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}

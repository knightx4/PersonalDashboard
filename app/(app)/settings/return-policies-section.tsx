'use client';

import { useActionState } from 'react';
import {
  saveMerchantReturnPolicy,
  type ActionState,
} from '@/app/(app)/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import type { MerchantPolicyRow } from '@/lib/returns/policies';

const initial: ActionState = {};

function PolicyRow({ policy }: { policy: MerchantPolicyRow }) {
  const [state, action, pending] = useActionState(saveMerchantReturnPolicy, initial);
  const defaultValue =
    policy.effectiveDays == null ? '' : String(policy.effectiveDays);

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{policy.name}</p>
          <p className="text-[12px] text-ink-muted">
            {policy.hasOverride
              ? `Custom · seeded default ${policy.seededDays ?? 'none'}`
              : policy.seededDays != null
                ? `Default ${policy.seededDays} days`
                : 'No seeded default'}
            {policy.onOrders ? '' : ' · common retailer'}
          </p>
        </div>
      </div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="merchant_id" value={policy.merchantId} />
        <div className="min-w-[7rem] flex-1">
          <Label htmlFor={`window-${policy.merchantId}`}>Days</Label>
          <Input
            id={`window-${policy.merchantId}`}
            name="return_window_days"
            inputMode="numeric"
            placeholder="None"
            defaultValue={defaultValue}
            key={`${policy.merchantId}-${defaultValue}-${policy.hasOverride}`}
          />
        </div>
        <Button type="submit" name="intent" value="save" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {policy.hasOverride && (
          <Button
            type="submit"
            name="intent"
            value="reset"
            size="sm"
            variant="secondary"
            disabled={pending}
          >
            Use default
          </Button>
        )}
      </form>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[12px] text-positive">{state.message}</p>}
    </li>
  );
}

export function ReturnPoliciesSection({ policies }: { policies: MerchantPolicyRow[] }) {
  const onOrders = policies.filter((p) => p.onOrders);
  const common = policies.filter((p) => !p.onOrders);

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">
        Deadlines on the returns tracker use delivery date plus this window. Common retailers
        are preloaded; edit any of them or clear a window entirely. Your changes never alter
        the shared merchant catalog.
      </p>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Merchants you have ordered from
        </h3>
        {onOrders.length === 0 ? (
          <p className="text-sm text-ink-faint">
            No order merchants yet — common retailers below still apply once you import
            orders.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {onOrders.map((policy) => (
              <PolicyRow key={policy.merchantId} policy={policy} />
            ))}
          </ul>
        )}
      </div>

      {common.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Common retailers
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {common.map((policy) => (
              <PolicyRow key={policy.merchantId} policy={policy} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

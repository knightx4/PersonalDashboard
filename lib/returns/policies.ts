/**
 * Merchant return-policy catalog for Settings.
 * Searchable list of every merchant the user can see, plus override state.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectiveReturnWindowDays } from '@/lib/returns/deadline';

export type MerchantPolicyRow = {
  merchantId: string;
  name: string;
  seededDays: number | null;
  overrideDays: number | null;
  hasOverride: boolean;
  effectiveDays: number | null;
  /** True when this merchant appears on at least one of the user's orders. */
  onOrders: boolean;
  isGlobal: boolean;
};

function buildRow(input: {
  id: string;
  name: string;
  seededDays: number | null;
  isGlobal: boolean;
  onOrders: boolean;
  overrideMap: Map<string, number | null>;
}): MerchantPolicyRow {
  const hasOverride = input.overrideMap.has(input.id);
  const overrideDays = hasOverride ? (input.overrideMap.get(input.id) ?? null) : null;
  return {
    merchantId: input.id,
    name: input.name,
    seededDays: input.seededDays,
    overrideDays,
    hasOverride,
    effectiveDays: effectiveReturnWindowDays({
      seededDays: input.seededDays,
      override: hasOverride ? { returnWindowDays: overrideDays } : null,
    }),
    onOrders: input.onOrders,
    isGlobal: input.isGlobal,
  };
}

export async function loadMerchantReturnPolicies(
  supabase: SupabaseClient,
  userId: string,
): Promise<MerchantPolicyRow[]> {
  const [{ data: merchants }, { data: orderRows }, { data: overrides }] = await Promise.all([
    supabase
      .from('merchants')
      .select('id, name, default_return_window_days, is_global, created_by_user_id')
      .or(`is_global.eq.true,created_by_user_id.eq.${userId}`)
      .order('name'),
    supabase
      .from('orders')
      .select('merchant_id')
      .eq('user_id', userId)
      .not('merchant_id', 'is', null),
    supabase
      .from('merchant_return_policies')
      .select('merchant_id, return_window_days')
      .eq('user_id', userId),
  ]);

  const overrideMap = new Map(
    (overrides ?? []).map((row) => [
      row.merchant_id as string,
      row.return_window_days as number | null,
    ]),
  );

  const onOrderIds = new Set(
    (orderRows ?? [])
      .map((row) => row.merchant_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );

  const byId = new Map<string, MerchantPolicyRow>();

  for (const merchant of merchants ?? []) {
    byId.set(
      merchant.id,
      buildRow({
        id: merchant.id,
        name: merchant.name as string,
        seededDays: (merchant.default_return_window_days as number | null) ?? null,
        isGlobal: Boolean(merchant.is_global),
        onOrders: onOrderIds.has(merchant.id),
        overrideMap,
      }),
    );
  }

  // Overrides pointing at merchants that somehow aren't in the visible set.
  const missingOverrideIds = [...overrideMap.keys()].filter((id) => !byId.has(id));
  if (missingOverrideIds.length > 0) {
    const { data: orphanMerchants } = await supabase
      .from('merchants')
      .select('id, name, default_return_window_days, is_global')
      .in('id', missingOverrideIds);
    for (const merchant of orphanMerchants ?? []) {
      byId.set(
        merchant.id,
        buildRow({
          id: merchant.id,
          name: merchant.name as string,
          seededDays: (merchant.default_return_window_days as number | null) ?? null,
          isGlobal: Boolean(merchant.is_global),
          onOrders: onOrderIds.has(merchant.id),
          overrideMap,
        }),
      );
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

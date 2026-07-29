/**
 * Load merchants the user can edit return windows for:
 * merchants on their orders, plus common seeded globals with a known window.
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

export async function loadMerchantReturnPolicies(
  supabase: SupabaseClient,
  userId: string,
): Promise<MerchantPolicyRow[]> {
  const [{ data: orderMerchants }, { data: commonMerchants }, { data: overrides }] =
    await Promise.all([
      supabase
        .from('orders')
        .select('merchant_id, merchants!inner ( id, name, default_return_window_days, is_global )')
        .eq('user_id', userId)
        .not('merchant_id', 'is', null),
      supabase
        .from('merchants')
        .select('id, name, default_return_window_days, is_global')
        .eq('is_global', true)
        .not('default_return_window_days', 'is', null)
        .order('name'),
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

  const byId = new Map<string, MerchantPolicyRow>();

  for (const row of orderMerchants ?? []) {
    const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
    if (!merchant?.id) continue;
    const seeded = (merchant.default_return_window_days as number | null) ?? null;
    const hasOverride = overrideMap.has(merchant.id);
    const overrideDays = hasOverride ? (overrideMap.get(merchant.id) ?? null) : null;
    byId.set(merchant.id, {
      merchantId: merchant.id,
      name: merchant.name as string,
      seededDays: seeded,
      overrideDays,
      hasOverride,
      effectiveDays: effectiveReturnWindowDays({
        seededDays: seeded,
        override: hasOverride ? { returnWindowDays: overrideDays } : null,
      }),
      onOrders: true,
      isGlobal: Boolean(merchant.is_global),
    });
  }

  for (const merchant of commonMerchants ?? []) {
    if (byId.has(merchant.id)) continue;
    const seeded = merchant.default_return_window_days as number | null;
    const hasOverride = overrideMap.has(merchant.id);
    // Only surface unused commons when they have a seeded window (preload),
    // or the user already saved an override.
    if (!hasOverride && seeded == null) continue;
    const overrideDays = hasOverride ? (overrideMap.get(merchant.id) ?? null) : null;
    byId.set(merchant.id, {
      merchantId: merchant.id,
      name: merchant.name as string,
      seededDays: seeded,
      overrideDays,
      hasOverride,
      effectiveDays: effectiveReturnWindowDays({
        seededDays: seeded,
        override: hasOverride ? { returnWindowDays: overrideDays } : null,
      }),
      onOrders: false,
      isGlobal: true,
    });
  }

  // Overrides for merchants that fell out of the lists above (e.g. seed cleared).
  const missingOverrideIds = [...overrideMap.keys()].filter((id) => !byId.has(id));
  if (missingOverrideIds.length > 0) {
    const { data: orphanMerchants } = await supabase
      .from('merchants')
      .select('id, name, default_return_window_days, is_global')
      .in('id', missingOverrideIds);
    for (const merchant of orphanMerchants ?? []) {
      const overrideDays = overrideMap.get(merchant.id) ?? null;
      const seeded = merchant.default_return_window_days as number | null;
      byId.set(merchant.id, {
        merchantId: merchant.id,
        name: merchant.name as string,
        seededDays: seeded,
        overrideDays,
        hasOverride: true,
        effectiveDays: overrideDays,
        onOrders: false,
        isGlobal: Boolean(merchant.is_global),
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.onOrders !== b.onOrders) return a.onOrders ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

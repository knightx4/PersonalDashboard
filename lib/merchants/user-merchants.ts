import type { SupabaseClient } from '@supabase/supabase-js';

export type UserMerchant = {
  id: string;
  name: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMerchantId(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value || !UUID_RE.test(value)) return undefined;
  return value;
}

/** Distinct merchants that appear on the user's orders, sorted by name. */
export async function loadUserMerchants(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserMerchant[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('merchant_id, merchants!inner ( id, name )')
    .eq('user_id', userId)
    .not('merchant_id', 'is', null);

  if (error) throw error;

  const byId = new Map<string, string>();
  for (const row of data ?? []) {
    const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
    if (!merchant?.id || !merchant.name) continue;
    byId.set(merchant.id as string, merchant.name as string);
  }

  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantExclusionRow } from '@/lib/inbox/merchant-exclusion-match';

export type { MerchantExclusionRow } from '@/lib/inbox/merchant-exclusion-match';
export { isExcludedSender } from '@/lib/inbox/merchant-exclusion-match';

export async function loadMerchantExclusions(
  supabase: SupabaseClient,
  userId: string,
): Promise<MerchantExclusionRow[]> {
  const { data, error } = await supabase
    .from('merchant_exclusions')
    .select('merchant_id, match_domain')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as MerchantExclusionRow[];
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendOperation } from '@/lib/core/spend/operations';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { runPriceLookups, type PriceRunResult } from './price-run';

/** What a resale estimate is recorded under, on the sell page and from Dash. */
export const ESTIMATE_SPEND: SpendOperation = { module: 'shopping', operation: 'estimate-resale-price' };

/**
 * One press of Price now on the sell page, or Dash's price_items_for_sale
 * once approved (plan #2228.5): run the lookups and record what the web
 * estimates cost, as the person. `ids` names items to price fresh; with none
 * it walks the for-sale list, filling in what has no price unless `rescan`.
 */
export async function priceItemsFor(input: {
  supabase: SupabaseClient;
  userId: string;
  ids?: string[];
  rescan?: boolean;
}): Promise<PriceRunResult> {
  const spend: SpendReport[] = [];
  const result = await runPriceLookups({
    supabase: input.supabase,
    userId: input.userId,
    ids: input.ids,
    // A named item is always re-fetched; a sweep of the whole list fills gaps.
    skipPriced: input.ids === undefined && !input.rescan,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(input.userId, ESTIMATE_SPEND, spend);
  return result;
}

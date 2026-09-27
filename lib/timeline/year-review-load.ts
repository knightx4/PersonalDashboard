import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { YEAR_REVIEW_COLUMNS, type YearReviewRecord } from './year-review';

/**
 * The signed-in person's stored review of one year, or null when none has
 * been written (plan #1121). Pass the request's own client: core.year_reviews
 * is read under RLS.
 */
export async function readYearReview(client: SupabaseClient, year: number): Promise<YearReviewRecord | null> {
  const { data, error } = await client
    .schema('core')
    .from('year_reviews')
    .select(YEAR_REVIEW_COLUMNS)
    .eq('year', year)
    .maybeSingle();
  if (error) throw new Error(`Could not read the year's review: ${error.message}`);
  return (data as unknown as YearReviewRecord | null) ?? null;
}

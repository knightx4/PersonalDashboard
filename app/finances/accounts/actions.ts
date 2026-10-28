'use server';

import { revalidatePath } from 'next/cache';
import { retryMonthReview } from '@/inngest/finances/month-review';
import { createClient, requireUser } from '@/lib/auth/server';
import { FINANCES_SCHEMA } from '@/lib/finances/db/schema-name';

/**
 * Try again on a monthly money review that failed (plan #2593.8.3). The
 * person cannot write finances.month_reviews, so the run goes through the
 * service role in retryMonthReview, after their own client has shown the
 * month's review is theirs and failed. One Sonnet call, recorded as
 * 'write-money-review'. A run that fails again leaves the row failed with
 * one more attempt; it never touches a written review.
 */
// latency: pending
export async function tryMonthReviewAgain(month: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { error: 'That review could not be found.' };
  }
  const { data, error } = await (await createClient())
    .schema(FINANCES_SCHEMA)
    .from('month_reviews')
    .select('status')
    .eq('user_id', user.id)
    .eq('month', `${month}-01`)
    .maybeSingle();
  if (error) return { error: 'The review could not be read. Try again.' };
  if (!data) return { error: 'That review could not be found.' };
  if ((data as { status: string }).status !== 'failed') {
    revalidatePath('/finances/accounts');
    return {};
  }

  const result = await retryMonthReview(user.id, month);
  revalidatePath('/finances/accounts');
  if (result.status === 'failed') return { error: 'Dash could not write it this time either.' };
  return {};
}

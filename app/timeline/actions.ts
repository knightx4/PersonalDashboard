'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { currentYear, parseYear } from '@/lib/timeline/year-review';
import { yearReviewPorts } from '@/lib/timeline/year-review-ports';
import { writeYearReviewFor, yearReviewRefusal, type YearReviewResult } from '@/lib/timeline/year-review-run';

/**
 * Mark one of the week's observations not useful (plan #1120). It is hidden
 * from the home page and the timeline for good, and the next weekly run is
 * given its sentence as something to leave alone (lib/timeline/
 * observations-run.ts). RLS lets the person change only the verdict and when
 * it was given, and only on their own rows.
 */
// latency: optimistic -- the observation leaves the list at once, and a refused write puts it back with a toast
export async function markObservationNotUseful(id: string): Promise<{ error: string | null }> {
  if (!z.string().uuid().safeParse(id).success) return { error: 'That observation could not be found.' };

  await requireUser();
  const client = await createClient();
  const { data, error } = await client
    .schema('core')
    .from('observations')
    .update({ verdict: 'not_useful', verdict_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) return { error: 'That did not save. Try again.' };
  if (!data || data.length === 0) return { error: 'That observation is no longer there.' };

  revalidatePath('/');
  revalidatePath('/timeline');
  return { error: null };
}

export type WriteYearState = { status: 'idle' } | { status: 'written' } | { status: 'failed'; message: string };

/**
 * Write the review of a year, or write the current year's again (plan
 * #1121). The run reads the year from the timeline, has Dash write around
 * the counts, and stores what passes the checks (lib/timeline/
 * year-review-run.ts). A year written up after it ended is refused, here and
 * by the table's trigger. Takes up to about half a minute.
 */
// latency: pending
export async function writeYearReview(_previous: WriteYearState, form: FormData): Promise<WriteYearState> {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
  const now = new Date();
  const year = parseYear(String(form.get('year') ?? ''), currentYear(now, settings.timezone));
  if (year == null) return { status: 'failed', message: 'That year cannot be written up.' };

  let result: YearReviewResult;
  try {
    const core = await createCoreClient();
    result = await writeYearReviewFor(yearReviewPorts(core), {
      userId: user.id,
      year,
      timezone: settings.timezone,
      now,
    });
  } catch {
    return { status: 'failed', message: 'Dash could not write the review. Try again.' };
  }

  const refusal = yearReviewRefusal(result, year);
  if (refusal) return { status: 'failed', message: refusal };
  revalidatePath(`/timeline/year/${year}`);
  return { status: 'written' };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { FEEDBACK_COLUMNS, feedbackRowFrom } from '@/lib/feedback/load';
import { ITEM_COLUMNS, planItemFromRow } from '@/lib/plan/load';
import { buildChangelog, type ChangelogDay } from './entries';

/**
 * The shipped rows for an account, in one read.
 *
 * Separate from `./entries` for the reason `lib/plan/load.ts` is separate from
 * `lib/plan/tree.ts`: the query side is the part a test cannot pin, so nothing
 * that decides what appears lives here. Takes a client rather than building
 * one, like everything else in lib/.
 *
 * Two queries and no more — nothing per entry. Each is capped the way the
 * feedback queue is capped: a changelog is read from the top, and the day
 * somebody scrolls back two hundred entries is the day it earns paging.
 */

const LIMIT = 200;

export async function loadChangelog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<ChangelogDay[]> {
  const [{ data: steps }, { data: notes }] = await Promise.all([
    supabase
      .from('plan_items')
      .select(ITEM_COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('feedback_items')
      .select(FEEDBACK_COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(LIMIT),
  ]);

  return buildChangelog({
    plan: ((steps ?? []) as unknown as Array<Record<string, unknown>>).map(planItemFromRow),
    notes: ((notes ?? []) as unknown as Array<Record<string, unknown>>).map(feedbackRowFrom),
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { FEEDBACK_COLUMNS, feedbackRowFrom } from '@/lib/feedback/load';
import { ITEM_COLUMNS, planItemFromRow } from '@/lib/plan/load';
import { changelogEntries, type ChangelogEntry, type PlanParentRow } from './entries';

/**
 * The shipped rows for an account, in one read.
 *
 * Separate from `./entries` for the reason `lib/plan/load.ts` is separate from
 * `lib/plan/tree.ts`: the query side is the part a test cannot pin, so nothing
 * that decides what appears lives here. Takes a client rather than building
 * one, like everything else in lib/.
 *
 * Three queries and no more — nothing per entry. The first two are capped the
 * way the feedback queue is capped: a changelog is read from the top, and the
 * day somebody scrolls back two hundred entries is the day it earns paging.
 *
 * The third is the plan's own shape: id, number, title and parent, for every
 * row rather than only the closed ones. Grouping by issue needs the name of
 * the feature a step sat under, and a shipped step's feature is usually still
 * open, so it is not among the rows above. Four thin columns for the whole
 * plan is cheaper than any per-entry lookup and is the reason this stays one
 * round of queries.
 */

const LIMIT = 200;

export async function loadChangelog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<ChangelogEntry[]> {
  const [{ data: steps }, { data: notes }, { data: parents }] = await Promise.all([
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
    supabase.from('plan_items').select('id, number, title, parent_id').eq('user_id', userId),
  ]);

  return changelogEntries({
    plan: ((steps ?? []) as unknown as Array<Record<string, unknown>>).map(planItemFromRow),
    notes: ((notes ?? []) as unknown as Array<Record<string, unknown>>).map(feedbackRowFrom),
    planParents: ((parents ?? []) as unknown as Array<Record<string, unknown>>).map(
      (row): PlanParentRow => ({
        id: row.id as string,
        number: row.number as number,
        title: row.title as string,
        parentId: (row.parent_id as string | null) ?? null,
      }),
    ),
  });
}

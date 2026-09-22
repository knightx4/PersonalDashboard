/**
 * What happened anywhere beneath a step, for the readers of a run's liveness.
 *
 * A run is fired at a feature and a feature closes only once every step
 * beneath it closes, so a feature with one blocked or `proposed` step never
 * closes and a reader asking the feature row alone learns nothing about the
 * session. Migration 0089 moved that question to the subtree, and 0092 did the
 * same for the block #678 started stamping.
 *
 * Here rather than beside either caller because both the overnight tick and
 * the claim sweep ask it, and the sweep is imported by the tick -- a helper
 * living in one of them would have to be imported by the other in a circle.
 *
 * Each reading is one indexed statement rather than the tree pulled over the
 * wire every four minutes to answer a question about one branch of it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * One of the two subtree readings, with the row itself as the fallback.
 *
 * A function that cannot be reached falls back to the root row's own column.
 * That is the reading this code took before 0089 -- too strict, never wrong --
 * and a caller that gave up here would stop the runner firing for the rest of
 * the night over a failed lookup, which is a worse trade than being slow.
 */
async function subtreeStamp(
  supabase: Db,
  root: string,
  fn: 'plan_subtree_closed_at' | 'plan_subtree_blocked_at',
  column: 'completed_at' | 'blocked_at',
): Promise<string | null> {
  const { data, error } = await supabase.rpc(fn, { root });
  if (!error) return (data as string | null) ?? null;

  console.error(`${fn} could not be read; falling back: ${error.message}`);
  const { data: item } = await supabase
    .from('plan_items')
    .select(column)
    .eq('id', root)
    .maybeSingle();
  return (item as Record<string, string | null> | null)?.[column] ?? null;
}

/** The newest close on a step or anything beneath it, or null if nothing has. */
export async function subtreeClosedAt(supabase: Db, root: string): Promise<string | null> {
  return subtreeStamp(supabase, root, 'plan_subtree_closed_at', 'completed_at');
}

/**
 * The newest block on a step or anything beneath it, or null if none has.
 *
 * The step a session stopped on is the work it did last, so this is as much
 * the end of a run as a close is -- and it is the only one of the two that a
 * session which answered nothing leaves behind. #679.
 */
export async function subtreeBlockedAt(supabase: Db, root: string): Promise<string | null> {
  return subtreeStamp(supabase, root, 'plan_subtree_blocked_at', 'blocked_at');
}

/**
 * Whether anything beneath a feature is claimed, and when any row in its
 * subtree last changed. Read for `featureRunIdle`.
 *
 * The account's rows are read and walked here rather than through a database
 * function: it is three narrow columns, and one account's plan is a few
 * hundred rows. Null when the rows cannot be read, so the caller falls back
 * to the push readings rather than ending a run on a failed lookup.
 */
export async function subtreeTrail(
  supabase: Db,
  userId: string,
  root: string,
): Promise<{ claimed: boolean; touchedAt: string | null } | null> {
  const { data, error } = await supabase
    .from('plan_items')
    .select('id, parent_id, status, updated_at')
    .eq('user_id', userId);
  if (error) {
    console.error(`plan_items could not be read for the feature trail: ${error.message}`);
    return null;
  }
  const rows = (data ?? []) as Array<{
    id: string;
    parent_id: string | null;
    status: string;
    updated_at: string;
  }>;
  const children = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row]);
  }

  let claimed = false;
  let touchedAt: string | null = rows.find((row) => row.id === root)?.updated_at ?? null;
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop() as string) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child.id);
      if (child.status === 'in_progress') claimed = true;
      if (!touchedAt || new Date(child.updated_at) > new Date(touchedAt)) {
        touchedAt = child.updated_at;
      }
    }
  }
  return { claimed, touchedAt };
}

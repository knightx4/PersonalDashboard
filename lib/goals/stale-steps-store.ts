import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  touchTimes,
  type CommentTouch,
  type ProgressTouch,
  type TouchRow,
} from '@/lib/goals/stale-steps';

/**
 * When each of the owner's steps was last touched, for the morning brief's
 * list of steps that have sat for a week (lib/goals/stale-steps.ts): each
 * live step's own row, the comments you left on it, and the progress entries
 * logged on it that were not undone.
 */
export async function loadStepTouches(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<Map<string, number>> {
  const [items, comments, progress] = await Promise.all([
    client
      .from('items')
      .select('id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('level', 'step')
      .is('archived_at', null),
    // Your turns in the threads on goals and steps (plan #1470).
    client
      .schema('core')
      .from('thread_turns')
      .select('ref, created_at')
      .eq('user_id', userId)
      .eq('author', 'me')
      .like('ref', 'goals.items:%'),
    client
      .from('progress_entries')
      .select('item_id, created_at')
      .eq('user_id', userId)
      .is('undone_at', null),
  ]);
  if (items.error) throw new Error(`Could not read when steps were last touched: ${items.error.message}`);
  if (comments.error) throw new Error(`Could not read comments on steps: ${comments.error.message}`);
  if (progress.error) throw new Error(`Could not read progress on steps: ${progress.error.message}`);
  const touches: CommentTouch[] = ((comments.data ?? []) as { ref: string; created_at: string }[]).map((row) => ({
    item_id: row.ref.slice(row.ref.indexOf(':') + 1),
    created_at: row.created_at,
  }));
  return touchTimes(
    (items.data ?? []) as TouchRow[],
    touches,
    (progress.data ?? []) as ProgressTouch[],
  );
}

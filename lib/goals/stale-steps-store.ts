import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { touchTimes, type CommentTouch, type TouchRow } from '@/lib/goals/stale-steps';

/**
 * When each of the owner's steps was last touched, for the morning brief's
 * list of steps that have sat for a week (lib/goals/stale-steps.ts): each
 * live step's own row, and the comments you left on it.
 */
export async function loadStepTouches(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<Map<string, number>> {
  const [items, comments] = await Promise.all([
    client
      .from('items')
      .select('id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('level', 'step')
      .is('archived_at', null),
    client.from('comments').select('item_id, created_at').eq('user_id', userId).eq('author', 'me'),
  ]);
  if (items.error) throw new Error(`Could not read when steps were last touched: ${items.error.message}`);
  if (comments.error) throw new Error(`Could not read comments on steps: ${comments.error.message}`);
  return touchTimes((items.data ?? []) as TouchRow[], (comments.data ?? []) as CommentTouch[]);
}

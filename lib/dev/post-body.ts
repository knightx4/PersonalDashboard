import type { SchemaClient } from '@/lib/ask/db';
import { OPEN_POST_STATUSES } from '@/lib/dev/posts';

/**
 * Replace the text of a draft still waiting to be posted, as the Posts tab's
 * edit and Dash's rewrite_post both do (plan #2473.5). Only `body` changes:
 * `draft` keeps what the posts run first wrote, so the gap between the two
 * still shows how the person edits. The thread comes in already cleaned
 * (cleanThread). Scoped to the user and to the open statuses, so a borrowed
 * id or a draft posted in another tab changes nothing; the row comes back as
 * it is now, or null when there was no open draft of theirs to change.
 */
export async function rewritePostBody(
  supabase: SchemaClient,
  userId: string,
  id: string,
  body: readonly string[],
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('social_posts')
    .update({ body })
    .eq('user_id', userId)
    .eq('id', id)
    .in('status', OPEN_POST_STATUSES)
    .select('*');
  if (error) return { row: null, error: error.message };
  return { row: ((data ?? []) as Record<string, unknown>[])[0] ?? null, error: null };
}

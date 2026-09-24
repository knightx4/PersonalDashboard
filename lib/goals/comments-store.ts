import 'server-only';

import { threadFrom, type CommentAuthor, type DevComment } from '@/lib/comments/load';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * Reads and writes for the threads on goals and steps (plan #957), in
 * goals.comments (goals migration 0013). As everywhere in Goals, the client
 * decides whose rows are seen, and a client made as the `claude` actor may
 * only add Dash's own replies: the database refuses it anything else.
 */

/** Every thread on the given goals and steps, oldest first, keyed by item id. */
export async function loadThreads(
  client: GoalsSupabaseClient,
  itemIds: string[],
): Promise<Record<string, DevComment[]>> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from('comments')
    .select('id, item_id, author, body, created_at')
    .in('item_id', ids)
    .order('created_at');
  if (error) throw new Error(`Could not read comments: ${error.message}`);
  const rows = (data ?? []) as { item_id: string }[];
  const byItem: Record<string, unknown[]> = {};
  for (const row of rows) (byItem[row.item_id] ??= []).push(row);
  return Object.fromEntries(Object.entries(byItem).map(([id, list]) => [id, threadFrom(list)]));
}

/** Write one comment; the new row's id. */
export async function writeComment(
  client: GoalsSupabaseClient,
  input: { userId: string; itemId: string; author: CommentAuthor; body: string },
): Promise<string> {
  const { data, error } = await client
    .from('comments')
    .insert({
      user_id: input.userId,
      item_id: input.itemId,
      author: input.author,
      body: input.body,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'The comment was not saved.');
  return data.id as string;
}

/** Take a comment back out. False when there was none of yours with that id. */
export async function deleteComment(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('comments').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * The live goal a goal or step belongs to, with the item's own title, or null
 * when it is not a live item of yours. Walks up through parents; a person's
 * tree is hundreds of rows, so one read of them all is cheaper than a read per
 * level.
 */
export async function goalOfItem(
  client: GoalsSupabaseClient,
  itemId: string,
): Promise<{ goalId: string; title: string } | null> {
  const { data, error } = await client
    .from('items')
    .select('id, parent_id, level, title')
    .is('archived_at', null);
  if (error) throw new Error(`Could not read the goal: ${error.message}`);
  const rows = new Map(
    ((data ?? []) as { id: string; parent_id: string | null; level: string; title: string }[]).map(
      (row) => [row.id, row],
    ),
  );
  const item = rows.get(itemId);
  if (!item) return null;
  let at: typeof item | undefined = item;
  for (let hops = 0; at && hops < 100; hops += 1) {
    if (at.level === 'goal') return { goalId: at.id, title: item.title };
    at = at.parent_id ? rows.get(at.parent_id) : undefined;
  }
  return null;
}

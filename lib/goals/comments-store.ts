import 'server-only';

import type { CommentAuthor, DevComment } from '@/lib/comments/load';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { addThreadTurn, loadThreads as loadRowThreads, removeThreadTurn, rowRef } from '@/lib/thread/store';

/**
 * Reads and writes for the threads on goals and steps (plan #957). Since plan
 * #1470 they are kept in core.conversations under each item's ref,
 * `goals.items:<id>`, like every other thread (lib/thread/store.ts);
 * goals.comments is read-only. The client decides whose threads are seen.
 */

/** The table goals and steps live in, the table half of their refs. */
export const GOAL_ITEMS_TABLE = 'goals.items';

/** Every thread on the given goals and steps, oldest first, keyed by item id. */
export async function loadThreads(
  client: GoalsSupabaseClient,
  itemIds: string[],
): Promise<Record<string, DevComment[]>> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return {};
  const byRef = await loadRowThreads(
    client,
    ids.map((id) => rowRef(GOAL_ITEMS_TABLE, id)),
  );
  return Object.fromEntries(
    ids.flatMap((id) => {
      const thread = byRef.get(rowRef(GOAL_ITEMS_TABLE, id));
      return thread ? [[id, thread]] : [];
    }),
  );
}

/** Write one comment; the new turn's id. */
export async function writeComment(
  client: GoalsSupabaseClient,
  input: { userId: string; itemId: string; author: CommentAuthor; body: string },
): Promise<string> {
  return addThreadTurn(client, {
    userId: input.userId,
    ref: rowRef(GOAL_ITEMS_TABLE, input.itemId),
    author: input.author,
    body: input.body,
  });
}

/** Take a comment back out. False when there was none of yours with that id. */
export async function deleteComment(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  return (await removeThreadTurn(client, { id })) !== null;
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

import 'server-only';

import type { SchemaClient } from '@/lib/ask/db';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { goalListViews, type ListView } from '@/lib/goals/goal-lists';
import type { ListedKind } from '@/lib/goals/links';
import { loadLinkedLists } from '@/lib/goals/links-store';
import { loadGoalLists } from '@/lib/goals/lists-store';
import { THREAD_TABLES } from '@/lib/thread/subjects';
import { loadThreads, rowRef } from '@/lib/thread/store';

/**
 * Every list on one goal, its own and its linked ones, as the page draws them
 * (plan #2330.3). `db` is a client of the person's own session, so each
 * workspace's row level security decides which linked rows are seen; `kinds`
 * leaves out the kinds of a workspace that is switched off.
 *
 * A linked reading carries the count of its comments, read from Learn's
 * thread on the reading. A goal's own rows have no thread of their own.
 */
export async function loadGoalListViews(
  clients: { goals: GoalsSupabaseClient; db: SchemaClient },
  userId: string,
  goalId: string,
  kinds: readonly ListedKind[],
  options: { today: string; timeZone: string },
): Promise<ListView[]> {
  const [own, linked] = await Promise.all([
    loadGoalLists(clients.goals, userId, goalId),
    loadLinkedLists(clients.db, goalId, kinds),
  ]);
  const readings = linked.flatMap((list) => list.rows.filter((row) => row.kind === 'reading' && !row.gone));
  const comments = new Map<string, number>();
  if (readings.length > 0) {
    const threads = await loadThreads(
      clients.db,
      readings.map((row) => rowRef(THREAD_TABLES.reading, row.targetId)),
      { userId },
    ).catch(() => new Map());
    for (const row of readings) {
      const turns = threads.get(rowRef(THREAD_TABLES.reading, row.targetId));
      if (turns && turns.length > 0) comments.set(row.linkId, turns.length);
    }
  }
  return goalListViews(own, linked, { ...options, comments });
}

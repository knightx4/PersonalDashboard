import type { SearchHit } from '@/lib/search/sources';

/**
 * Goals and their steps into hits, apart from the read so the hrefs can be
 * tested without a database -- the same split as dev-map.ts.
 *
 * A goal has a page, /goals/<id>. A step does not: it is a row on its goal's
 * page, anchored as `step-<id>` (the same href the done-since list and the
 * files page write). A step can sit under another step, so its goal is found
 * by walking `parent_id` up to the item whose level is `goal`; a step whose
 * goal is not among the rows read (archived, merged, dropped) has no page to
 * open and is left out.
 *
 * Decisions are left out as they are from the dev plan's hits: a question put
 * to you is answered where it is asked, not found. So are dropped rows.
 * Open work comes before finished work, which is what the box is for.
 */

export type GoalItemRow = {
  id: string;
  level: string;
  parent_id: string | null;
  title: string;
  status: string;
  kind: string | null;
};

/** The goal an item belongs to, or null when the chain leaves the rows read. */
export function goalOf(
  item: GoalItemRow,
  byId: ReadonlyMap<string, GoalItemRow>,
): GoalItemRow | null {
  let current: GoalItemRow | undefined = item;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.level === 'goal') return current;
    visited.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return null;
}

/**
 * Where an item opens: a goal on its own page, a step as a row on its goal's.
 * A step whose goal is not among the rows read falls back to its parent's
 * page, which is the goal for every step that is not a sub-step.
 */
export function goalItemHref(
  item: GoalItemRow,
  byId: ReadonlyMap<string, GoalItemRow>,
): string {
  if (item.level === 'goal') return `/goals/${item.id}`;
  const goalId = goalOf(item, byId)?.id ?? item.parent_id;
  return goalId ? `/goals/${goalId}#step-${item.id}` : `/goals/${item.id}`;
}

const FINISHED = new Set(['done']);

export function goalHits(
  rows: readonly GoalItemRow[],
  { query, limit }: { query?: string; limit: number },
): SearchHit[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const needle = query?.trim().toLowerCase();
  const hits: { hit: SearchHit; finished: boolean }[] = [];

  for (const row of rows) {
    if (row.status === 'dropped' || row.kind === 'decision') continue;
    if (needle && !row.title.toLowerCase().includes(needle)) continue;

    const goal = goalOf(row, byId);
    if (!goal || goal.status === 'dropped') continue;

    const finished = FINISHED.has(row.status);
    if (row.level === 'goal') {
      hits.push({
        finished,
        hit: {
          module: 'goals',
          kind: 'goal',
          id: row.id,
          ref: `goals.items:${row.id}`,
          title: row.title,
          subtitle: finished ? 'Goal · done' : 'Goal',
          href: `/goals/${row.id}`,
        },
      });
    } else {
      hits.push({
        finished,
        hit: {
          module: 'goals',
          kind: 'step',
          id: row.id,
          ref: `goals.items:${row.id}`,
          title: row.title,
          subtitle: `Step · ${goal.title}`,
          href: goalItemHref(row, byId),
        },
      });
    }
  }

  // Stable, so the read's own order (most recently touched) holds within each.
  return hits
    .sort((a, b) => Number(a.finished) - Number(b.finished))
    .slice(0, limit)
    .map(({ hit }) => hit);
}

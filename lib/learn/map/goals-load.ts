import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LensRecord } from '@/lib/learn/levels/lenses';
import { goalsBySubject, listLenses } from '@/lib/learn/levels/lens-store';
import type { TopicMap } from '@/lib/learn/levels/model';
import { loadTopicMap } from '@/lib/learn/levels/store';

/**
 * What Idea Space reads for your prepared subjects (plan #2187.2, #2317.1):
 * every subject lens with topics, a territory whether or not a goal reads it
 * (plan #2302.3 made one lens per subject; survey subjects are already left
 * out by `listLenses`), the open goals on each subject, the map of
 * topics their progress and links come from, and the scope embedding of
 * every topic on a goal, which places it on the sky.
 *
 * Through the person's session only: RLS keeps every read to theirs and the
 * shared territory. The page is the one caller.
 */

/** Ids per `in` filter, so a request's address stays short. */
const IN_CHUNK = 200;

export type GoalRows = {
  lenses: LensRecord[];
  /** The open goals' names by subject id, for the subjects a goal reads. */
  goalNames: Map<string, string[]>;
  map: TopicMap;
  /** Each goal topic's scope embedding as stored, or null before the daily fill reaches it. */
  vectors: { id: string; embedding: string | number[] | null }[];
};

export async function loadGoalRows(learn: LearnSupabaseClient): Promise<GoalRows> {
  const [all, map, goals] = await Promise.all([
    listLenses(learn),
    loadTopicMap(learn, { quotes: true }),
    goalsBySubject(learn),
  ]);
  // A prepared subject is a territory with or without a goal; a lens with no
  // targets has nothing to draw. One lens per subject, so none is drawn twice.
  const lenses = all.filter((lens) => lens.subjectId !== null && lens.targets.length > 0);
  const goalNames = new Map([...goals].map(([subjectId, list]) => [subjectId, list.map((g) => g.name)]));
  const ids = [...new Set(lenses.flatMap((lens) => lens.targets.map((t) => t.topicId)))].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const reads = await Promise.all(
    chunks.map((chunk) => learn.from('topics').select('id, scope_embedding').in('id', chunk)),
  );
  const vectors: GoalRows['vectors'] = [];
  for (const { data, error } of reads) {
    if (error) throw new Error(`Reading your goals' topics failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; scope_embedding: string | number[] | null }[]) {
      vectors.push({ id: row.id, embedding: row.scope_embedding });
    }
  }
  return { lenses, goalNames, map, vectors };
}

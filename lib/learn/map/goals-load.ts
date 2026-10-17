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
 * topics their progress and links come from, each topic on a lens with its
 * scope embedding, which places it on the sky, and its frame topic
 * (plan #2317.2), and each subject's field and domain, which colour its stars.
 *
 * Through the person's session only: RLS keeps every read to theirs and the
 * shared territory. The page is the one caller.
 */

/** Ids per `in` filter, so a request's address stays short. */
const IN_CHUNK = 200;

/** A topic on a lens as the sky reads it. */
export type SkyTopicRow = {
  id: string;
  name: string;
  scope: string | null;
  /** The Wikipedia topic it refines (learn.area_check_articles), whose evidence lights it. */
  refines_article_id: string | null;
  created_at: string | null;
  /** As stored, or null before the daily fill reaches it. */
  scope_embedding: string | number[] | null;
};

export type SubjectRow = { id: string; name: string; field_id: string | null; domain_id: string | null };

export type GoalRows = {
  lenses: LensRecord[];
  /** The open goals' names by subject id, for the subjects a goal reads. */
  goalNames: Map<string, string[]>;
  map: TopicMap;
  /** Every topic on a lens, once. */
  topics: SkyTopicRow[];
  /** The lenses' subjects. */
  subjects: SubjectRow[];
};

async function readIn<T>(
  ids: readonly string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const reads = await Promise.all(chunks.map(read));
  const out: T[] = [];
  for (const { data, error } of reads) {
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

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
  const subjectIds = [...new Set(lenses.map((lens) => lens.subjectId!))].sort();
  const [topics, subjects] = await Promise.all([
    readIn<SkyTopicRow>(
      ids,
      (chunk) =>
        learn
          .from('topics')
          .select('id, name, scope, refines_article_id, created_at, scope_embedding')
          .in('id', chunk) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
      "your subjects' topics",
    ),
    readIn<SubjectRow>(
      subjectIds,
      (chunk) =>
        learn
          .from('subjects')
          .select('id, name, field_id, domain_id')
          .in('id', chunk) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
      'your subjects',
    ),
  ]);
  return { lenses, goalNames, map, topics, subjects };
}

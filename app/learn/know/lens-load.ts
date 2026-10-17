import 'server-only';

import { createClient } from '@/lib/auth/server';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fieldLevels, summariseLens, type FieldLevel, type LensSummary } from '@/lib/learn/levels/lenses';
import { goalsBySubject, listLenses, loadTopicFields, loadTopicNames } from '@/lib/learn/levels/lens-store';
import { readCells } from '@/lib/learn/levels/model';
import { loadTopicMap } from '@/lib/learn/levels/store';
import { loadTableThreads } from '@/lib/thread/store';
import { THREAD_TABLES } from '@/lib/thread/subjects';

export type KnowLenses = {
  /** Each subject's lens, by subject id. */
  bySubject: Map<string, LensSummary>;
  /** The names of the open learning goals on each subject, by subject id; a goal reads its subject's lens. */
  goalNames: Map<string, string[]>;
  /** Comment counts by lens id. */
  comments: Map<string, number>;
  fields: FieldLevel[];
};

/**
 * What the Know page shows of lenses (plan #2138.7): every subject's lens
 * summarised against the whole map, read once, the goals on each subject
 * (plan #2302.3), and each field's mean level. Null when the lenses or the
 * map could not be read; the comments or the goals failing only drops the
 * counts or the names.
 */
export async function loadKnowLenses(learn: LearnSupabaseClient, userId: string): Promise<KnowLenses | null> {
  try {
    const [lenses, map, names, tags, fields, threads, goals] = await Promise.all([
      listLenses(learn),
      loadTopicMap(learn),
      loadTopicNames(learn),
      loadTopicFields(learn),
      learn.from('area_fields').select('id, name').order('position'),
      createClient()
        .then((core) => loadTableThreads(core, THREAD_TABLES.lens, { userId }))
        .catch((error: unknown) => {
          console.error('[learn know] lens comments', error instanceof Error ? error.message : error);
          return new Map<string, unknown[]>();
        }),
      goalsBySubject(learn).catch((error: unknown) => {
        console.error('[learn know] goals on subjects', error instanceof Error ? error.message : error);
        return new Map<string, { name: string }[]>();
      }),
    ]);
    if (fields.error) throw new Error(fields.error.message);

    const readings = readCells(map);
    const bySubject = new Map<string, LensSummary>();
    for (const lens of lenses) {
      if (lens.subjectId) bySubject.set(lens.subjectId, summariseLens(lens, map, readings, names));
    }
    const goalNames = new Map([...goals].map(([subjectId, list]) => [subjectId, list.map((goal) => goal.name)]));

    const comments = new Map<string, number>();
    for (const [ref, turns] of threads) comments.set(ref.slice(ref.indexOf(':') + 1), turns.length);

    return {
      bySubject,
      goalNames,
      comments,
      fields: fieldLevels(map, readings, tags, (fields.data ?? []) as { id: string; name: string }[]),
    };
  } catch (error) {
    console.error('[learn know] lenses', error instanceof Error ? error.message : error);
    return null;
  }
}

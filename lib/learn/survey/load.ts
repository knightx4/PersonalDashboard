import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { readAll } from '@/lib/learn/db/read-all';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { tallySurvey, type SurveyCounts } from './pick';

/**
 * The survey questions already answered, counted per theme and field for the
 * Know grid and the track offer (plan #841). Nothing writes survey questions
 * since plan #2313.2; these are the ones asked before. Read through the
 * session, so RLS keeps it to the viewer's own rows.
 */

/** Ids per `in` filter. A hundred uuids keep the query string short. */
const CHUNK = 100;

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/** Run `read` over `ids` a chunk at a time and put the rows together. */
async function inChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  action: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < ids.length; from += CHUNK) {
    const { data, error } = await read(ids.slice(from, from + CHUNK));
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail(action, error);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/** Each placed theme's field, from `learn.theme_fields`. */
async function loadPlacements(supabase: LearnSupabaseClient): Promise<Map<string, string>> {
  const rows = await readAll<{ theme_id: string; field_id: string }>((from, to) =>
    supabase
      .from('theme_fields')
      .select('theme_id, field_id')
      .not('field_id', 'is', null)
      .order('theme_id')
      .range(from, to),
  );
  return new Map(rows.map((row) => [row.theme_id, row.field_id]));
}

/**
 * Survey questions written and answered, per field and per theme. A goal's
 * questions (plan #1385) count in the goal's field and in no theme.
 *
 * For Practice Flow's survey rate (#842) and the Know grid (#843) as well as
 * the pick: `byField.get(fieldId)?.answered` is how many survey questions in
 * that field have been answered. A theme's field is read from
 * `learn.theme_fields`; pass `placements` when they are already loaded.
 * Questions thrown away unshown are not counted.
 */
export async function loadSurveyCounts(
  supabase: LearnSupabaseClient,
  placements?: ReadonlyMap<string, string>,
): Promise<SurveyCounts> {
  const [subjectRead, aimRead, fields] = await Promise.all([
    supabase.from('subjects').select('id, theme_id, aim_id').eq('survey', true),
    // A goal's questions count in the goal's field (plan #1385).
    supabase.from('aims').select('id, field_id').not('field_id', 'is', null),
    placements ? Promise.resolve(placements) : loadPlacements(supabase),
  ]);
  assertSchemaExposed(subjectRead.error ?? aimRead.error, LEARN_SCHEMA);
  if (subjectRead.error) throw fail('Reading the survey subjects', subjectRead.error);
  if (aimRead.error) throw fail('Reading where your goals are placed', aimRead.error);

  const aimField = new Map(
    ((aimRead.data ?? []) as { id: string; field_id: string }[]).map((row) => [
      row.id,
      row.field_id,
    ]),
  );
  const subjects = (
    (subjectRead.data ?? []) as { id: string; theme_id: string | null; aim_id: string | null }[]
  ).flatMap((row): { id: string; themeId: string | null; goalFieldId?: string }[] => {
    if (row.theme_id) return [{ id: row.id, themeId: row.theme_id }];
    const goalFieldId = row.aim_id ? aimField.get(row.aim_id) : undefined;
    return goalFieldId ? [{ id: row.id, themeId: null, goalFieldId }] : [];
  });
  const concepts = await inChunks<{ id: string; subject_id: string }>(
    subjects.map((subject) => subject.id),
    (chunk) => supabase.from('concepts').select('id, subject_id').in('subject_id', chunk),
    'Reading the survey ideas',
  );
  const probes = await inChunks<{ concept_id: string; answered_at: string | null }>(
    concepts.map((concept) => concept.id),
    (chunk) =>
      supabase
        .from('probes')
        .select('concept_id, answered_at')
        .in('concept_id', chunk)
        .is('discarded_at', null),
    'Reading the survey questions',
  );

  return tallySurvey({
    subjects,
    placements: fields,
    concepts: concepts.map((row) => ({ id: row.id, subjectId: row.subject_id })),
    probes: probes.map((row) => ({
      conceptId: row.concept_id,
      answered: row.answered_at !== null,
      answeredAt: row.answered_at,
    })),
  });
}

import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { readAll } from '@/lib/learn/areas/grid-load';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { tallySurvey, type SurveyCounts, type SurveyPool, type SurveyTheme } from './pick';

/**
 * The rows the survey pick reads (plan #841).
 *
 * Two clients, as in `grid-load.ts`: themes and their note links are in the
 * vault's schema, placements, tracks and questions in learn's, and they are
 * joined here by theme id. Both go through the session, so RLS keeps each to
 * the viewer's own rows.
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
 * Survey questions written and answered, per field and per theme.
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
  const [subjectRead, fields] = await Promise.all([
    supabase.from('subjects').select('id, theme_id').eq('survey', true),
    placements ? Promise.resolve(placements) : loadPlacements(supabase),
  ]);
  assertSchemaExposed(subjectRead.error, LEARN_SCHEMA);
  if (subjectRead.error) throw fail('Reading the survey subjects', subjectRead.error);

  const subjects = ((subjectRead.data ?? []) as { id: string; theme_id: string | null }[]).flatMap(
    (row) => (row.theme_id ? [{ id: row.id, themeId: row.theme_id }] : []),
  );
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
    })),
  });
}

/**
 * Every theme placed in a field, the tracks that rule themes and fields out,
 * and the survey counts, for `surveyCandidates`.
 *
 * A field counts as tested by a track the way the Know grid counts it: a track
 * placed there with an idea that has a `tested_at`.
 */
export async function loadSurveyPool(
  supabase: LearnSupabaseClient,
  vault: VaultSupabaseClient,
): Promise<SurveyPool> {
  const [placements, themes, links, fieldRead, trackRead, tested] = await Promise.all([
    loadPlacements(supabase),
    readAll<{ id: string; name: string; strength: number | string | null }>((from, to) =>
      vault.from('themes').select('id, name, strength').order('id').range(from, to),
    ),
    readAll<{ theme_id: string }>((from, to) =>
      vault.from('theme_notes').select('theme_id').order('id').range(from, to),
    ),
    supabase.from('area_fields').select('id, name'),
    supabase.from('subjects').select('id, name, theme_id, field_id, placed_at').eq('survey', false),
    readAll<{ concepts: { subject_id: string } | null }>((from, to) =>
      supabase
        .from('concept_state')
        .select('concept_id, concepts!concept_state_concept_fk(subject_id)')
        .not('tested_at', 'is', null)
        .order('concept_id')
        .range(from, to),
    ),
  ]);
  assertSchemaExposed(fieldRead.error ?? trackRead.error, LEARN_SCHEMA);
  if (fieldRead.error) throw fail('Reading the fields', fieldRead.error);
  if (trackRead.error) throw fail('Reading your tracks', trackRead.error);

  const counts = await loadSurveyCounts(supabase, placements);

  const withNotes = new Set(links.map((link) => link.theme_id));
  const surveyThemes: SurveyTheme[] = themes.flatMap((theme) => {
    const fieldId = placements.get(theme.id);
    if (!fieldId) return [];
    return [
      {
        id: theme.id,
        name: theme.name,
        // numeric comes back from PostgREST as a string.
        strength: Number(theme.strength ?? 0) || 0,
        fieldId,
        hasNotes: withNotes.has(theme.id),
      },
    ];
  });

  const tracks = (trackRead.data ?? []) as {
    id: string;
    name: string;
    theme_id: string | null;
    field_id: string | null;
    placed_at: string | null;
  }[];
  const testedTracks = new Set(
    tested.flatMap((row) => (row.concepts ? [row.concepts.subject_id] : [])),
  );

  return {
    themes: surveyThemes,
    fieldNames: new Map(
      ((fieldRead.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]),
    ),
    trackThemeIds: new Set(tracks.flatMap((track) => (track.theme_id ? [track.theme_id] : []))),
    trackNames: tracks.map((track) => track.name),
    trackTestedFields: new Set(
      tracks.flatMap((track) =>
        track.placed_at && track.field_id && testedTracks.has(track.id) ? [track.field_id] : [],
      ),
    ),
    counts,
  };
}

/** An idea in a survey subject that no question has been written about. */
export type UnaskedIdea = {
  subjectId: string;
  conceptId: string;
  name: string;
  claim: string;
  mastery: string[];
};

/**
 * The oldest idea in the theme's survey subject with no question written
 * about it, or null. An idea is left like that when its question could not be
 * written, and using it again saves writing another.
 */
export async function loadUnaskedSurveyIdea(
  supabase: LearnSupabaseClient,
  themeId: string,
): Promise<UnaskedIdea | null> {
  const { data: subject, error } = await supabase
    .from('subjects')
    .select('id')
    .eq('theme_id', themeId)
    .eq('survey', true)
    .maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the survey subject', error);
  if (!subject) return null;
  const subjectId = (subject as { id: string }).id;

  const { data: conceptData, error: conceptError } = await supabase
    .from('concepts')
    .select('id, name, claim, mastery')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  assertSchemaExposed(conceptError, LEARN_SCHEMA);
  if (conceptError) throw fail('Reading the survey ideas', conceptError);
  const concepts = (conceptData ?? []) as {
    id: string;
    name: string;
    claim: string;
    mastery: string[] | null;
  }[];
  if (concepts.length === 0) return null;

  const asked = await inChunks<{ concept_id: string }>(
    concepts.map((concept) => concept.id),
    (chunk) => supabase.from('probes').select('concept_id').in('concept_id', chunk),
    'Reading the survey questions',
  );
  const askedIds = new Set(asked.map((row) => row.concept_id));
  const idea = concepts.find((concept) => !askedIds.has(concept.id));
  return idea
    ? {
        subjectId,
        conceptId: idea.id,
        name: idea.name,
        claim: idea.claim,
        mastery: idea.mastery ?? [],
      }
    : null;
}

import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { readAll } from '@/lib/learn/areas/grid-load';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { generateChain } from '@/lib/learn/graph/generate';
import { loadReadyAndSettled, loadSubjects } from '@/lib/learn/graph/load';
import { saveChain } from '@/lib/learn/graph/save';
import { PUSHED_ASIDE_DAYS } from '@/lib/learn/next/rank';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { loadThemeMap } from '@/lib/vault/map/read';
import { NEVER_PULL, offerLean, type ThemeAnchor, type TrackWeight } from './interest';
import { loadTrackInterest } from './interest-load';

/**
 * New tracks offered in Practice Flow from the vault map (plan #778).
 *
 * When the flow is running low on questions, it offers a track built from the
 * strongest theme in your notes that you have no track for yet. The offer is a
 * card with Start, Not now and Never (#776). Start writes the generated ideas
 * straight into a new track, with no approval screen, and each press is kept
 * in `learn.track_offers`.
 *
 * This is the first thing Learn reads from the vault map, and it reads only:
 * the theme's name, how strong it is, how many notes it covers, and the
 * positions under it as context for writing the ideas. Nothing is written back
 * to the map, and nothing from the notes counts as knowing anything
 * (KNOWLEDGE-SPEC.md, "Everything starts unknown").
 *
 * Which theme is offered leans towards the tracks you engage with (plan #780):
 * a theme's strength is multiplied by `offerLean` from `interest.ts`, which
 * counts how many notes it shares with the theme behind each weighted track.
 *
 * Before that, the offer looks at the field you write about most and have
 * never been tested in (plan #800), read the way the Know grid reads it: the
 * fields with themes placed in them and no answered question in any track
 * placed there, ordered by summed theme strength. When that field has a theme
 * left to offer, the strongest one is offered and the card names the field.
 */

/**
 * Fewer ready ideas than this across every track and the flow is running low.
 * "About ten" is the step's own wording.
 */
export const LOW_WATER = 10;

/**
 * How many of the strongest themes are read to choose from. Enough that a
 * theme four times lighter than the strongest can still be lifted past it by
 * the lean towards tracks you engage with.
 */
const THEMES_READ = 150;

/** How many of a theme's positions go into the prompt. */
const POSITIONS_IN_PROMPT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OfferOutcome = 'started' | 'not_now' | 'never';

/** A theme as the offer weighs it. */
export type ThemeCandidate = {
  id: string;
  name: string;
  about: string;
  strength: number;
  notes: number;
  /** The notes it covers, for how near it is to other themes. */
  noteIds?: string[];
};

/** One press on an earlier offer. */
export type OfferRecord = {
  themeId: string;
  themeName: string;
  outcome: OfferOutcome;
  happenedAt: string;
  /** The track a Start made. Unset for Not now and Never. */
  subjectId?: string | null;
};

/** What the card shows. */
export type TrackOffer = {
  themeId: string;
  name: string;
  about: string;
  notes: number;
  /**
   * The field the theme was chosen from, when the offer came from the field
   * you write about most and have never been tested in. Unset otherwise.
   */
  field?: string;
};

/** A theme's placement in a field, from `learn.theme_fields`. */
export type ThemePlacement = { themeId: string; fieldId: string };

/** A track's placement, and whether any question in it has been answered. */
export type TrackPlacement = { fieldId: string | null; answered: boolean };

/** The field an offer is chosen from, with the ids of the themes placed in it. */
export type UntestedField = { id: string; name: string; themeIds: string[] };

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * The theme to offer, or null.
 *
 * The strongest theme that covers at least one note and that:
 *   - has no track of the same name, however it got there;
 *   - was never started from an offer before, even if that track was deleted
 *     since, because deleting it says as much as Never does;
 *   - was not declined with Never;
 *   - was not pushed aside with Not now in the last few weeks.
 *
 * A record matches a theme by id or by name, because a later sweep can merge
 * or rename a theme and give it a new id.
 *
 * Strongest after `lean`, the multiplier from `offerLean`: a theme near a
 * track you answer a lot is offered before a slightly stronger one that is
 * not. A theme missing from `lean` keeps its own strength.
 */
export function trackToOffer(input: {
  themes: ThemeCandidate[];
  trackNames: string[];
  record: OfferRecord[];
  now: Date;
  lean?: ReadonlyMap<string, number>;
  /**
   * The field you write about most and have never been tested in, with the
   * themes placed in it. Its strongest theme left after the exclusions below
   * is offered first; when there is none, the offer falls back to `themes`.
   */
  field?: { name: string; themes: ThemeCandidate[] } | null;
}): TrackOffer | null {
  const taken = new Set(input.trackNames.map(key));
  const heldUntil = input.now.getTime() - PUSHED_ASIDE_DAYS * DAY_MS;

  const closedIds = new Set<string>();
  const closedNames = new Set<string>();
  for (const row of input.record) {
    const closes =
      row.outcome !== 'not_now' || new Date(row.happenedAt).getTime() >= heldUntil;
    if (!closes) continue;
    closedIds.add(row.themeId);
    closedNames.add(key(row.themeName));
  }

  const open = (candidate: ThemeCandidate) =>
    candidate.notes > 0 &&
    !taken.has(key(candidate.name)) &&
    !closedIds.has(candidate.id) &&
    !closedNames.has(key(candidate.name));
  const card = (theme: ThemeCandidate) => ({
    themeId: theme.id,
    name: theme.name,
    about: theme.about,
    notes: theme.notes,
  });

  if (input.field) {
    const fromField = [...input.field.themes]
      .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name))
      .find(open);
    if (fromField) return { ...card(fromField), field: input.field.name };
  }

  const weighed = (theme: ThemeCandidate) => theme.strength * (input.lean?.get(theme.id) ?? 1);
  const theme = [...input.themes]
    .sort((a, b) => weighed(b) - weighed(a) || a.name.localeCompare(b.name))
    .find(open);
  return theme ? card(theme) : null;
}

/**
 * The field you write about most and have never been tested in, or null.
 *
 * The Know grid's reading: a field counts when at least one theme is placed
 * in it and no track placed there has an answered question. A track placed
 * there with nothing answered does not rule the field out. Fields are ordered
 * by the summed strength of the themes placed in them; a placement whose
 * theme is not in `strengths` is left out, as the grid leaves it out.
 */
export function strongestUntestedField(input: {
  fields: { id: string; name: string }[];
  placements: ThemePlacement[];
  strengths: ReadonlyMap<string, number>;
  tracks: TrackPlacement[];
}): UntestedField | null {
  const tested = new Set(
    input.tracks.filter((track) => track.answered && track.fieldId).map((track) => track.fieldId),
  );
  const themesIn = new Map<string, string[]>();
  for (const placement of input.placements) {
    if (!input.strengths.has(placement.themeId)) continue;
    const ids = themesIn.get(placement.fieldId) ?? [];
    ids.push(placement.themeId);
    themesIn.set(placement.fieldId, ids);
  }
  const summed = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (input.strengths.get(id) ?? 0), 0);

  let best: UntestedField | null = null;
  let bestStrength = 0;
  for (const field of input.fields) {
    const themeIds = themesIn.get(field.id);
    if (!themeIds || tested.has(field.id)) continue;
    const strength = summed(themeIds);
    if (
      !best ||
      strength > bestStrength ||
      (strength === bestStrength && field.name.localeCompare(best.name) < 0)
    ) {
      best = { id: field.id, name: field.name, themeIds };
      bestStrength = strength;
    }
  }
  return best;
}

/** Whether this many ready ideas counts as running low. */
export function runningLow(ready: number): boolean {
  return ready < LOW_WATER;
}

type NoteLinks = { note_id: string }[] | null;

async function loadThemes(vault: VaultSupabaseClient): Promise<ThemeCandidate[]> {
  const { data, error } = await vault
    .from('themes')
    .select('id, name, about, strength, theme_notes(note_id)')
    .order('strength', { ascending: false })
    .limit(THEMES_READ);
  if (error) throw fail('Reading the themes in your notes', error);

  return ((data ?? []) as unknown as ThemeRow[]).map(toCandidate);
}

/** Every press on a track offer, newest first. */
export async function loadOfferRecord(supabase: LearnSupabaseClient): Promise<OfferRecord[]> {
  const { data, error } = await supabase
    .from('track_offers')
    .select('theme_id, theme_name, outcome, happened_at, subject_id')
    .order('happened_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading what you did with offered tracks', error);

  return (
    (data ?? []) as {
      theme_id: string;
      theme_name: string;
      outcome: OfferOutcome;
      happened_at: string;
      subject_id: string | null;
    }[]
  ).map((row) => ({
    themeId: row.theme_id,
    themeName: row.theme_name,
    outcome: row.outcome,
    happenedAt: row.happened_at,
    subjectId: row.subject_id,
  }));
}

/**
 * The track to offer now, or null when the flow is not running low or there
 * is no theme left to offer.
 *
 * Mixed flow only: the caller does not ask while the flow is focused on one
 * track. Never throws: an offer that could not be worked out is an offer not
 * made, and the question on the screen matters more.
 */
export async function loadTrackOffer(
  supabase: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  now: Date = new Date(),
): Promise<TrackOffer | null> {
  try {
    const rows = await loadReadyAndSettled(supabase, LOW_WATER, null);
    if (!runningLow(rows.ready.length)) return null;

    const [themes, subjects, record, interest, field] = await Promise.all([
      loadThemes(vault),
      loadSubjects(supabase),
      loadOfferRecord(supabase),
      loadTrackInterest(supabase, now).catch((error: unknown) => {
        console.error('[learn flow] track weights', error instanceof Error ? error.message : error);
        return null;
      }),
      // A field that could not be read leaves today's choice, the same as no
      // field qualifying.
      loadUntestedField(supabase, vault).catch((error: unknown) => {
        console.error(
          '[learn flow] untested field',
          error instanceof Error ? error.message : error,
        );
        return null;
      }),
    ]);
    const anchors = interest
      ? await loadAnchors(vault, subjects, record, interest.weights).catch(() => [])
      : [];
    return trackToOffer({
      themes,
      trackNames: subjects.map((subject) => subject.name),
      record,
      now,
      lean: offerLean(
        themes.map((theme) => ({ id: theme.id, notes: new Set(theme.noteIds ?? []) })),
        anchors,
      ),
      field,
    });
  } catch (error) {
    console.error('[learn flow] track offer', error instanceof Error ? error.message : error);
    return null;
  }
}

type ThemeRow = {
  id: string;
  name: string;
  about: string;
  strength: number | string;
  theme_notes: NoteLinks;
};

function toCandidate(row: ThemeRow): ThemeCandidate {
  const noteIds = (row.theme_notes ?? []).map((link) => link.note_id);
  return {
    id: row.id,
    name: row.name,
    about: row.about,
    strength: Number(row.strength) || 0,
    notes: noteIds.length,
    noteIds,
  };
}

/**
 * The field you write about most and have never been tested in, with every
 * theme placed in it, or null when no field qualifies.
 *
 * The same rows the Know grid reads (`grid-load.ts`): placements from
 * `learn.theme_fields`, strengths from `obsidian.themes`, tracks' placements
 * from `learn.subjects`. Answered is any idea in the track with a `tested_at`,
 * which is what `trackTested` counts off the graph, read here without loading
 * every graph.
 */
async function loadUntestedField(
  supabase: LearnSupabaseClient,
  vault: VaultSupabaseClient,
): Promise<{ name: string; themes: ThemeCandidate[] } | null> {
  const [fieldRead, trackRead, placements, strengths, answered] = await Promise.all([
    supabase.from('area_fields').select('id, name'),
    supabase.from('subjects').select('id, field_id, placed_at').eq('survey', false),
    readAll<{ theme_id: string; field_id: string }>((from, to) =>
      supabase
        .from('theme_fields')
        .select('theme_id, field_id')
        .not('field_id', 'is', null)
        .order('theme_id')
        .range(from, to),
    ),
    readAll<{ id: string; strength: number | string | null }>((from, to) =>
      vault.from('themes').select('id, strength').order('id').range(from, to),
    ),
    readAll<{ concept_id: string; concepts: { subject_id: string } | null }>((from, to) =>
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
  if (trackRead.error) throw fail('Reading where your tracks are placed', trackRead.error);

  const answeredTracks = new Set(
    answered.flatMap((row) => (row.concepts ? [row.concepts.subject_id] : [])),
  );
  const field = strongestUntestedField({
    fields: (fieldRead.data ?? []) as { id: string; name: string }[],
    placements: placements.map((row) => ({ themeId: row.theme_id, fieldId: row.field_id })),
    strengths: new Map(strengths.map((row) => [row.id, Number(row.strength ?? 0)])),
    tracks: (
      (trackRead.data ?? []) as { id: string; field_id: string | null; placed_at: string | null }[]
    ).map((row) => ({
      fieldId: row.placed_at ? row.field_id : null,
      answered: answeredTracks.has(row.id),
    })),
  });
  if (!field) return null;

  const { data, error } = await vault
    .from('themes')
    .select('id, name, about, strength, theme_notes(note_id)')
    .in('id', field.themeIds);
  if (error) throw fail('Reading the themes in that field', error);
  return { name: field.name, themes: ((data ?? []) as unknown as ThemeRow[]).map(toCandidate) };
}

/**
 * The themes that lean the offer, with the notes each covers.
 *
 * A weighted track pulls through the theme it was started from, when an offer
 * started it, and through any theme with its exact name. A track typed by hand
 * whose name matches no theme pulls nothing, since there is nothing in the map
 * to measure nearness from. An offer you pressed Never on pulls away.
 */
async function loadAnchors(
  vault: VaultSupabaseClient,
  subjects: { id: string; name: string }[],
  record: OfferRecord[],
  weights: Map<string, TrackWeight>,
): Promise<ThemeAnchor[]> {
  const pullOf = new Map<string, number>();
  const weighted = subjects.filter((subject) => (weights.get(subject.id)?.weight ?? 1) !== 1);

  for (const row of record) {
    if (row.outcome === 'never') pullOf.set(row.themeId, NEVER_PULL);
  }
  for (const row of record) {
    const weight = row.subjectId ? weights.get(row.subjectId)?.weight : undefined;
    if (row.outcome === 'started' && weight !== undefined && weight !== 1) {
      pullOf.set(row.themeId, weight);
    }
  }

  if (weighted.length > 0) {
    const { data, error } = await vault
      .from('themes')
      .select('id, name')
      .in(
        'name',
        weighted.map((subject) => subject.name),
      );
    if (error) throw fail('Reading the themes behind your tracks', error);
    const weightByName = new Map(
      weighted.map((subject) => [subject.name, weights.get(subject.id)!.weight]),
    );
    for (const theme of (data ?? []) as { id: string; name: string }[]) {
      const weight = weightByName.get(theme.name);
      if (weight !== undefined) pullOf.set(theme.id, weight);
    }
  }

  const ids = [...pullOf.keys()];
  if (ids.length === 0) return [];
  const { data, error } = await vault
    .from('theme_notes')
    .select('theme_id, note_id')
    .in('theme_id', ids);
  if (error) throw fail('Reading the notes behind your tracks', error);

  const notesOf = new Map<string, Set<string>>();
  for (const link of (data ?? []) as { theme_id: string; note_id: string }[]) {
    const notes = notesOf.get(link.theme_id) ?? new Set<string>();
    notes.add(link.note_id);
    notesOf.set(link.theme_id, notes);
  }
  return ids.map((themeId) => ({
    themeId,
    pull: pullOf.get(themeId)!,
    notes: notesOf.get(themeId) ?? new Set<string>(),
  }));
}

/** Keep one press on an offer. */
export async function recordTrackOffer(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    themeId: string;
    themeName: string;
    themeStrength?: number | null;
    outcome: OfferOutcome;
    subjectId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('track_offers').insert({
    user_id: userId,
    theme_id: input.themeId,
    theme_name: input.themeName,
    theme_strength: input.themeStrength ?? null,
    outcome: input.outcome,
    subject_id: input.outcome === 'started' ? (input.subjectId ?? null) : null,
  });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Keeping what you did with that track', error);
}

export type StartedTrack =
  | { ok: true; subjectId: string; name: string }
  | { ok: false; detail: string };

/**
 * Start: write a new track from a theme, with no approval screen (#776).
 *
 * The same call as naming a goal (`generateChain`), with the theme and the
 * positions under it passed in so the ideas are written around the person's
 * own examples. The track is named after the theme, which is what the card
 * promised. Every idea starts unknown.
 *
 * The theme is read again through the session's own client, so an id from the
 * form that is not one of your themes reads as no theme.
 */
export async function startTrackFromTheme(
  supabase: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  userId: string,
  themeId: string,
): Promise<StartedTrack> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'Starting a track needs ANTHROPIC_API_KEY to be set.' };

  const map = await loadThemeMap(vault, themeId);
  if (!map) return { ok: false, detail: 'That theme is no longer in your notes.' };

  const strength = await themeStrength(vault, themeId);
  const positions = map.positions
    .filter((position) => !position.ungrounded)
    // Their own arguments first, then ideas they recorded, and what a model
    // wrote for them last: the point is their wording.
    .sort((a, b) => STANCE_ORDER[a.stance] - STANCE_ORDER[b.stance])
    .slice(0, POSITIONS_IN_PROMPT)
    .map((position) => ({ name: position.name, statement: position.statement }));

  const spend = collectSpend();
  const result = await generateChain({
    goal: map.theme.name,
    subject: map.theme.name,
    existing: [],
    notes: { theme: { name: map.theme.name, about: map.theme.about }, positions },
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(userId, 'generate-track-from-theme', spend.reports);
  if (!result.ok) return { ok: false, detail: result.detail };

  let subjectId: string;
  try {
    const saved = await saveChain(
      supabase,
      userId,
      { ...result.chain, subject: map.theme.name },
      map.theme.name,
      { origin: 'generated', theme: { id: themeId, about: map.theme.about } },
    );
    subjectId = saved.subjectId;
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'Could not save that track.',
    };
  }

  await recordTrackOffer(supabase, userId, {
    themeId,
    themeName: map.theme.name,
    themeStrength: strength,
    outcome: 'started',
    subjectId,
  });
  return { ok: true, subjectId, name: map.theme.name };
}

const STANCE_ORDER: Record<string, number> = { held: 0, encountered: 1, generated: 2 };

/** The theme's strength now, for the record. Null when it cannot be read. */
export async function themeStrength(
  vault: VaultSupabaseClient,
  themeId: string,
): Promise<number | null> {
  const { data, error } = await vault
    .from('themes')
    .select('strength')
    .eq('id', themeId)
    .maybeSingle();
  if (error || !data) return null;
  return Number((data as { strength: number | string }).strength) || 0;
}

/** The theme's name, read through the session, or null when it is not yours. */
export async function themeName(
  vault: VaultSupabaseClient,
  themeId: string,
): Promise<string | null> {
  const { data, error } = await vault.from('themes').select('name').eq('id', themeId).maybeSingle();
  if (error || !data) return null;
  return (data as { name: string }).name;
}

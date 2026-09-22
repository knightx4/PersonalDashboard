import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { generateChain } from '@/lib/learn/graph/generate';
import { loadReadyAndSettled, loadSubjects } from '@/lib/learn/graph/load';
import { saveChain } from '@/lib/learn/graph/save';
import { PUSHED_ASIDE_DAYS } from '@/lib/learn/next/rank';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { loadThemeMap } from '@/lib/vault/map/read';

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
 */

/**
 * Fewer ready ideas than this across every track and the flow is running low.
 * "About ten" is the step's own wording.
 */
export const LOW_WATER = 10;

/** How many of the strongest themes are read to choose from. */
const THEMES_READ = 60;

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
};

/** One press on an earlier offer. */
export type OfferRecord = {
  themeId: string;
  themeName: string;
  outcome: OfferOutcome;
  happenedAt: string;
};

/** What the card shows. */
export type TrackOffer = {
  themeId: string;
  name: string;
  about: string;
  notes: number;
};

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
 */
export function trackToOffer(input: {
  themes: ThemeCandidate[];
  trackNames: string[];
  record: OfferRecord[];
  now: Date;
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

  const theme = [...input.themes]
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name))
    .find(
      (candidate) =>
        candidate.notes > 0 &&
        !taken.has(key(candidate.name)) &&
        !closedIds.has(candidate.id) &&
        !closedNames.has(key(candidate.name)),
    );
  return theme ? { themeId: theme.id, name: theme.name, about: theme.about, notes: theme.notes } : null;
}

/** Whether this many ready ideas counts as running low. */
export function runningLow(ready: number): boolean {
  return ready < LOW_WATER;
}

type Count = { count: number }[] | null;

async function loadThemes(vault: VaultSupabaseClient): Promise<ThemeCandidate[]> {
  const { data, error } = await vault
    .from('themes')
    .select('id, name, about, strength, theme_notes(count)')
    .order('strength', { ascending: false })
    .limit(THEMES_READ);
  if (error) throw fail('Reading the themes in your notes', error);

  return (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      about: string;
      strength: number | string;
      theme_notes: Count;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    about: row.about,
    strength: Number(row.strength) || 0,
    notes: row.theme_notes?.[0]?.count ?? 0,
  }));
}

/** Every press on a track offer, newest first. */
export async function loadOfferRecord(supabase: LearnSupabaseClient): Promise<OfferRecord[]> {
  const { data, error } = await supabase
    .from('track_offers')
    .select('theme_id, theme_name, outcome, happened_at')
    .order('happened_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading what you did with offered tracks', error);

  return (
    (data ?? []) as {
      theme_id: string;
      theme_name: string;
      outcome: OfferOutcome;
      happened_at: string;
    }[]
  ).map((row) => ({
    themeId: row.theme_id,
    themeName: row.theme_name,
    outcome: row.outcome,
    happenedAt: row.happened_at,
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

    const [themes, subjects, record] = await Promise.all([
      loadThemes(vault),
      loadSubjects(supabase),
      loadOfferRecord(supabase),
    ]);
    return trackToOffer({
      themes,
      trackNames: subjects.map((subject) => subject.name),
      record,
      now,
    });
  } catch (error) {
    console.error('[learn flow] track offer', error instanceof Error ? error.message : error);
    return null;
  }
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
      { origin: 'generated' },
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

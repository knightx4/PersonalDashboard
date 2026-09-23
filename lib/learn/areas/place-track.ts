import 'server-only';

import { after } from 'next/server';
import { loadAreas } from '@/lib/learn/areas/load';
import { PLACE_MODEL, placeTracks, type Placement } from '@/lib/learn/areas/place';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Placing one track into the areas (docs/LEARN-AREAS-SPEC.md, "Placement").
 *
 * A track started from a vault theme takes that theme's placement from
 * `learn.theme_fields`, with no model call: the theme was placed already, and
 * the track is named after it. Any other track is placed by one call to
 * `placeTracks`, given its name and a line saying what it covers.
 *
 * Never throws. A track is worth having unplaced, and a failed placement
 * leaves `placed_at` null, which the next chain written into the track reads
 * as a reason to try again. The write only lands on a row that is still
 * unplaced, so it never overwrites a placement moved by hand.
 */

export type TrackToPlace = {
  id: string;
  name: string;
  /** What the track covers, in a line: the goal and the first few ideas. */
  context: string;
};

/** The theme a track was started from, when it was. */
export type TrackTheme = { id: string; about: string };

export type TrackPlacementOutcome = 'copied' | 'placed' | 'failed';

type PlacementColumns = {
  field_id: string | null;
  domain_id: string | null;
  runner_up_field_id: string | null;
  placement_confidence: Placement['confidence'];
  placement_basis: string;
  placement_model: string | null;
};

async function write(
  supabase: LearnSupabaseClient,
  subjectId: string,
  columns: PlacementColumns,
): Promise<boolean> {
  const { error } = await supabase
    .from('subjects')
    .update({ ...columns, placed_at: new Date().toISOString() })
    .eq('id', subjectId)
    .is('placed_at', null);
  if (error) console.error('[learn place-track] write', error.message);
  return !error;
}

/** The theme's own placement, or null when it has none yet. */
async function themePlacement(
  supabase: LearnSupabaseClient,
  themeId: string,
): Promise<PlacementColumns | null> {
  const { data, error } = await supabase
    .from('theme_fields')
    .select('field_id, domain_id, runner_up_id, confidence, basis, model')
    .eq('theme_id', themeId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    field_id: string | null;
    domain_id: string | null;
    runner_up_id: string | null;
    confidence: Placement['confidence'];
    basis: string;
    model: string | null;
  };
  return {
    field_id: row.field_id,
    domain_id: row.domain_id,
    runner_up_field_id: row.runner_up_id,
    placement_confidence: row.confidence,
    placement_basis: row.basis,
    placement_model: row.model,
  };
}

export async function placeTrack(
  supabase: LearnSupabaseClient,
  userId: string,
  track: TrackToPlace,
  theme?: TrackTheme | null,
): Promise<TrackPlacementOutcome> {
  try {
    if (theme) {
      const copied = await themePlacement(supabase, theme.id);
      if (copied) return (await write(supabase, track.id, copied)) ? 'copied' : 'failed';
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return 'failed';

    const { fields, domains, fieldIds, domainIds } = await loadAreas(supabase);
    const spend = collectSpend();
    const result = await placeTracks({
      tracks: [{ title: track.name, context: theme?.about || track.context }],
      fields,
      domains,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(userId, 'place-track', spend.reports);

    const placement = result.ok ? result.placements[0] : undefined;
    if (!placement) {
      if (!result.ok) console.error('[learn place-track]', result.detail);
      return 'failed';
    }
    const ok = await write(supabase, track.id, {
      field_id: placement.field ? (fieldIds.get(placement.field) ?? null) : null,
      domain_id: placement.domain ? (domainIds.get(placement.domain) ?? null) : null,
      runner_up_field_id: placement.runnerUp ? (fieldIds.get(placement.runnerUp) ?? null) : null,
      placement_confidence: placement.confidence,
      placement_basis: placement.basis,
      placement_model: PLACE_MODEL,
    });
    return ok ? 'placed' : 'failed';
  } catch (error) {
    console.error('[learn place-track]', error instanceof Error ? error.message : error);
    return 'failed';
  }
}

/**
 * Place a track once the response has gone.
 *
 * The model call takes a few seconds and nothing on the screen that wrote the
 * track waits for it. Called only from server actions, where `after` may use
 * the session's cookies for the spend record.
 */
export function placeTrackAfterResponse(
  supabase: LearnSupabaseClient,
  userId: string,
  track: TrackToPlace,
  theme?: TrackTheme | null,
): void {
  after(() => placeTrack(supabase, userId, track, theme).then(() => undefined));
}

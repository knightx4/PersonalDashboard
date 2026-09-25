import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { placeTrackAfterResponse } from '@/lib/learn/areas/place-track';
import { startTrackFromTheme } from '@/lib/learn/flow/offer';
import { ensureCurriculum, fileGoalUnder } from '@/lib/learn/graph/curriculum-store';
import { findOrCreateSubject } from '@/lib/learn/graph/save';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * New tracks started from Learn now (LEARN-LESSONS-SPEC, "What the feed
 * deals", build step 2; plan #968).
 *
 * Two ways in. A track offer's Start makes the track from a theme in your
 * notes, and an exploratory card's "Make this a track" makes one from the
 * card's article. Either way the track leaves with its curriculum, so the
 * lesson top-up (lib/learn/lessons/top-up.ts) finds a unit to lay out and
 * starts writing its lessons into the feed. Neither waits for a lesson: the
 * top-up writes them in the background, as it does for every other track.
 *
 * Called only from server actions, where the placement may run after the
 * response has gone.
 */

export type NewTrack =
  | {
      ok: true;
      subjectId: string;
      name: string;
      /** How many units the curriculum has. Zero when writing it failed. */
      units: number;
    }
  | { ok: false; detail: string };

/**
 * Start, on a track offer in Learn now.
 *
 * The same start as Practice Flow's (`startTrackFromTheme`): the chain is
 * written around the theme's own positions and the press is kept in
 * `learn.track_offers`. Then the curriculum is written, and the chain is filed
 * under the unit it falls in, as approving a first chain on the Know tab does.
 * A curriculum that could not be written leaves the track, whose page offers
 * to write it again.
 */
export async function startTrackFromOffer(
  supabase: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  userId: string,
  themeId: string,
): Promise<NewTrack> {
  const started = await startTrackFromTheme(supabase, vault, userId, themeId);
  if (!started.ok) return started;

  const units = await writeUnits(
    supabase,
    userId,
    { id: started.subjectId, name: started.name },
    started.asked ?? started.name,
    started.goalId ?? null,
  );
  return { ok: true, subjectId: started.subjectId, name: started.name, units };
}

/**
 * Make this a track, on an exploratory card.
 *
 * The track is the card's article, as Test me on this names it, so a second
 * card from the same article reaches the same track. Only the curriculum is
 * written here, with the card's idea as what the track was asked for; the
 * first unit's chain is laid out by the top-up (`layOutNextUnit`), so the
 * press costs one call rather than two. A track of that name that already
 * has a curriculum keeps it.
 */
export async function makeTrackFromCard(
  supabase: LearnSupabaseClient,
  userId: string,
  card: { article: string; idea: string },
): Promise<NewTrack> {
  const name = card.article.trim();
  if (!name) return { ok: false, detail: 'This card names no article to make a track of.' };

  const subject = await findOrCreateSubject(supabase, userId, name);
  if (!subject.placed) {
    placeTrackAfterResponse(supabase, userId, {
      id: subject.id,
      name,
      context: `started from the idea: ${card.idea}`,
    });
  }

  const units = await writeUnits(supabase, userId, { id: subject.id, name }, card.idea, null);
  return { ok: true, subjectId: subject.id, name, units };
}

/** The track's curriculum, written if it has none. Never throws; returns how many units it has. */
async function writeUnits(
  supabase: LearnSupabaseClient,
  userId: string,
  subject: { id: string; name: string },
  asked: string,
  goalId: string | null,
): Promise<number> {
  try {
    const curriculum = await ensureCurriculum(supabase, userId, subject, asked);
    if (!curriculum.ok) {
      console.error('[learn new track] curriculum', curriculum.detail);
      return 0;
    }
    if (curriculum.goalUnitId && goalId) await fileGoalUnder(supabase, goalId, curriculum.goalUnitId);
    return curriculum.units.length;
  } catch (error) {
    console.error('[learn new track] curriculum', error instanceof Error ? error.message : error);
    return 0;
  }
}

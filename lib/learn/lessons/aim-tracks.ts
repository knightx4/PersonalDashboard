import 'server-only';

import { AIM_DEPTH_LABELS, isAimDepth, type AimDepth } from '@/lib/learn/aims';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { findOrCreateSubject } from '@/lib/learn/graph/save';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { ensureOutline } from './outline';

/**
 * Each learning goal's track (LEARN-LESSONS-SPEC, "What happens to today's
 * pieces" and build step 6; plan #972).
 *
 * An open goal on the Goals page has a track, recorded in `aims.subject_id`
 * (learn 0056), and the track is the goal's plan (plan #1143): its lessons are
 * on the plan's pieces, not in Learn now, and the top-up lays its units out
 * ahead (`plan-layout.ts`). The Level 3 goal is left out: it still draws
 * section cards from its list.
 *
 * The track is found by the goal's name, so a goal named like a track the
 * person already has takes that track. It takes the goal's placement when the
 * goal has one, with no model call, as a track started from a theme takes the
 * theme's. A goal not placed yet leaves the track unplaced, and the next chain
 * written into it places it.
 *
 * Two callers. Saving a goal gives it its track and writes the track's whole
 * outline from the goal's wording and depth (`giveAimsTracks`, plan #1139),
 * after the response. The Learn now top-up gives a track to any goal still
 * without one (`linkAimTracks`), with no model call; the top-up then writes
 * the outline of any goal's track that has none (`aimTrackFor`).
 *
 * Every read and write names the person, since the top-up runs with the
 * service role.
 */

type AimTrackRow = {
  id: string;
  name: string;
  about: string | null;
  depth: string;
  subject_id: string | null;
  field_id: string | null;
  domain_id: string | null;
  placement_confidence: string | null;
  placement_basis: string | null;
  placement_model: string | null;
  placed_at: string | null;
};

/** One active goal and its track. */
export type AimTrack = {
  aimId: string;
  subjectId: string;
  name: string;
  /** What the track's outline is written from. */
  asked: string;
  /** How well the person wants to know it, which sizes the outline. */
  depth: AimDepth;
};

/**
 * What a goal's track was asked for, for its curriculum: the goal's line, or
 * its name, and how well the person wants to know it.
 */
export function askedForAim(aim: { name: string; about: string | null; depth: string }): string {
  const depth = isAimDepth(aim.depth) ? aim.depth : 'familiar';
  const what = aim.about?.trim() || aim.name;
  return `${what}, as a learning goal: ${AIM_DEPTH_LABELS[depth].means}`;
}

/** The person's active open goals, with their tracks and placements. */
async function activeOpenAims(supabase: LearnSupabaseClient, userId: string): Promise<AimTrackRow[]> {
  const { data, error } = await supabase
    .from('aims')
    .select(
      'id, name, about, depth, subject_id, field_id, domain_id, placement_confidence, placement_basis, placement_model, placed_at',
    )
    .eq('user_id', userId)
    .is('archived_at', null)
    .is('list_source', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading your goals failed: ${error.message}`);
  return (data ?? []) as AimTrackRow[];
}

/** The subject ids of the person's active goals' tracks. */
export async function loadGoalTracks(supabase: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('aims')
    .select('subject_id')
    .eq('user_id', userId)
    .is('archived_at', null)
    .is('list_source', null)
    .not('subject_id', 'is', null);
  if (error) throw new Error(`Reading your goals' tracks failed: ${error.message}`);
  return new Set(((data ?? []) as { subject_id: string }[]).map((row) => row.subject_id));
}

/**
 * The goal's placement onto its track, when the goal is placed and the track
 * is not. The write only lands on a track still unplaced, so it never moves a
 * track placed before or by hand.
 */
async function copyPlacement(supabase: LearnSupabaseClient, userId: string, aim: AimTrackRow, subjectId: string) {
  if (!aim.placed_at) return;
  const { error } = await supabase
    .from('subjects')
    .update({
      field_id: aim.field_id,
      domain_id: aim.domain_id,
      placement_confidence: aim.placement_confidence,
      placement_basis: aim.placement_basis ?? `Placed as the learning goal ${aim.name}.`,
      placement_model: aim.placement_model,
      placed_at: new Date().toISOString(),
    })
    .eq('id', subjectId)
    .eq('user_id', userId)
    .is('placed_at', null);
  if (error) console.error('[learn aim tracks] placement', error.message);
}

/**
 * Every active open goal's track, made for any goal without one. No model
 * call. Throws only when the goals cannot be read.
 */
export async function linkAimTracks(supabase: LearnSupabaseClient, userId: string): Promise<AimTrack[]> {
  const aims = await activeOpenAims(supabase, userId);
  const tracks: AimTrack[] = [];
  for (const aim of aims) {
    try {
      let subjectId = aim.subject_id;
      if (!subjectId) {
        const subject = await findOrCreateSubject(supabase, userId, aim.name);
        const { data, error } = await supabase
          .from('aims')
          .update({ subject_id: subject.id })
          .eq('id', aim.id)
          .eq('user_id', userId)
          .is('subject_id', null)
          .select('subject_id');
        if (error) throw new Error(error.message);
        // Another run linked it first; read which track it took.
        subjectId = (data ?? []).length > 0 ? subject.id : await linkedTrack(supabase, userId, aim.id);
        if (!subjectId) continue;
      }
      await copyPlacement(supabase, userId, aim, subjectId);
      tracks.push(aimTrack(aim, subjectId));
    } catch (error) {
      console.error('[learn aim tracks] link', aim.id, error instanceof Error ? error.message : error);
    }
  }
  return tracks;
}

function aimTrack(aim: AimTrackRow, subjectId: string): AimTrack {
  return {
    aimId: aim.id,
    subjectId,
    name: aim.name,
    asked: askedForAim(aim),
    depth: isAimDepth(aim.depth) ? aim.depth : 'familiar',
  };
}

/**
 * The active open goal whose track this is, or null when it is no goal's.
 * The earliest goal wins when two share a track.
 */
export async function aimTrackFor(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<AimTrack | null> {
  const aim = (await activeOpenAims(supabase, userId)).find((row) => row.subject_id === subjectId);
  return aim ? aimTrack(aim, subjectId) : null;
}

async function linkedTrack(supabase: LearnSupabaseClient, userId: string, aimId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('aims')
    .select('subject_id')
    .eq('id', aimId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { subject_id: string | null } | null)?.subject_id ?? null;
}

/**
 * Give every active open goal its track and the track its whole outline, from
 * the goal's wording and depth (plan #1139). A track already outlined is left
 * alone, and one with units from before keeps them, with the outline after.
 * Called after a goal is saved, once its placement has been tried, where the
 * spend is recorded on the person's session. Never throws.
 */
export async function giveAimsTracks(supabase: LearnSupabaseClient, userId: string): Promise<void> {
  try {
    const tracks = await linkAimTracks(supabase, userId);
    for (const track of tracks) {
      const spend = collectSpend();
      const outline = await ensureOutline(supabase, userId, track, process.env.ANTHROPIC_API_KEY, spend.sink);
      await recordLearnSpend(userId, 'write-curriculum', spend.reports);
      if (outline.outcome === 'failed') console.error('[learn aim tracks] outline', outline.detail);
    }
  } catch (error) {
    console.error('[learn aim tracks]', error instanceof Error ? error.message : error);
  }
}

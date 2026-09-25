import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadTrackInterest } from '@/lib/learn/flow/interest-load';
import { loadSubjects } from '@/lib/learn/graph/load';
import { loadGoalTracks } from './aim-tracks';
import { restingTrackToOffer, type RestingOffer, type RestingOutcome, type RestingPress } from './resting';

/**
 * The reads and the write behind a resting track offered back in Learn now
 * (plan #1045). The rules are in `resting.ts`.
 *
 * The lesson chooser reads the presses with the service role, which RLS does
 * not narrow, so `loadRestingRecord` takes the person's id and names them.
 */

/** Every press on a resting-track offer, newest first. */
export async function loadRestingRecord(
  supabase: LearnSupabaseClient,
  userId: string,
): Promise<RestingPress[]> {
  const { data, error } = await supabase
    .from('track_offers')
    .select('subject_id, outcome, happened_at')
    .eq('user_id', userId)
    .eq('kind', 'resting')
    .not('subject_id', 'is', null)
    .order('happened_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading what you did with resting tracks failed: ${error.message}`);

  return ((data ?? []) as { subject_id: string; outcome: RestingOutcome; happened_at: string }[]).map(
    (row) => ({ subjectId: row.subject_id, outcome: row.outcome, happenedAt: row.happened_at }),
  );
}

/** The resting track to offer on this visit to Learn now, or null. Throws when a read fails. */
export async function chooseRestingOffer(
  supabase: LearnSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<RestingOffer | null> {
  const [subjects, interest, goalTracks, record] = await Promise.all([
    loadSubjects(supabase, userId),
    loadTrackInterest(supabase, now, userId),
    loadGoalTracks(supabase, userId),
    loadRestingRecord(supabase, userId),
  ]);
  return restingTrackToOffer({
    tracks: subjects.map((subject) => ({ subjectId: subject.id, name: subject.name })),
    activity: interest.activity,
    weights: interest.weights,
    goalTracks,
    record,
    now,
  });
}

/**
 * Keep one press on a resting-track offer. The track is read back first, so
 * an id that is not one of your tracks records nothing and returns false.
 */
export async function recordRestingPress(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
  outcome: RestingOutcome,
): Promise<boolean> {
  const { data: track, error: readError } = await supabase
    .from('subjects')
    .select('id')
    .eq('id', subjectId)
    .eq('user_id', userId)
    .eq('survey', false)
    .maybeSingle();
  assertSchemaExposed(readError, LEARN_SCHEMA);
  if (readError) throw new Error(`Reading that track failed: ${readError.message}`);
  if (!track) return false;

  const { error } = await supabase.from('track_offers').insert({
    user_id: userId,
    kind: 'resting',
    subject_id: subjectId,
    outcome,
  });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Keeping what you did with that track failed: ${error.message}`);
  return true;
}

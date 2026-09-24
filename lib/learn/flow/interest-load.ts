import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadSurveySubjectIds } from '@/lib/learn/survey/subject';
import {
  INTEREST_WINDOW_DAYS,
  trackWeights,
  type TrackActivity,
  type TrackShare,
  type TrackWeight,
} from './interest';

/**
 * Reading what you did with each track's questions, for `interest.ts`
 * (plan #780).
 *
 * Three reads through the session client: the questions shown or answered in
 * the last twelve weeks, the ideas pushed aside with Not now in the last four,
 * and which track each of those ideas is in. Nothing is written, and a page
 * being opened counts for nothing; the rows read here are written when a
 * question is shown, when it is answered, and when Not now is pressed.
 *
 * The lesson chooser runs with the service role, which RLS does not narrow, so
 * it passes `userId` and every read here then names the person.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back an answer counts towards "answered before": the eight weeks
 * before the window. Enough to tell a track you stopped from one you never
 * started, without reading every answer ever given.
 */
const BEFORE_DAYS = 56;

type ProbeRow = {
  concept_id: string;
  answered_at: string | null;
  shown_at: string | null;
  picked_state: string | null;
};

export type TrackInterest = {
  activity: Map<string, TrackActivity>;
  weights: Map<string, TrackWeight>;
  /** Questions from each track put in front of you in the window. */
  asked: Map<string, number>;
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

const blank = (): TrackActivity => ({ answered: 0, skipped: 0, pushedAside: 0, answeredBefore: 0 });

/** Every track's activity, weight and questions asked, as of `now`. */
export async function loadTrackInterest(
  supabase: LearnSupabaseClient,
  now: Date = new Date(),
  userId?: string,
): Promise<TrackInterest> {
  const windowStart = now.getTime() - INTEREST_WINDOW_DAYS * DAY_MS;
  const from = new Date(windowStart - BEFORE_DAYS * DAY_MS).toISOString();
  const since = new Date(windowStart).toISOString();

  let probeQuery = supabase
    .from('probes')
    .select('concept_id, answered_at, shown_at, picked_state')
    .or(`answered_at.gte.${from},shown_at.gte.${from}`)
    .is('discarded_at', null);
  let asideQuery = supabase
    .from('next_outcomes')
    .select('concept_id')
    .eq('outcome', 'not_now')
    .not('concept_id', 'is', null)
    .gte('happened_at', since);
  if (userId) {
    probeQuery = probeQuery.eq('user_id', userId);
    asideQuery = asideQuery.eq('user_id', userId);
  }
  const [probes, asides] = await Promise.all([probeQuery, asideQuery]);

  assertSchemaExposed(probes.error, LEARN_SCHEMA);
  if (probes.error) throw fail('Reading the questions you were asked', probes.error);
  assertSchemaExposed(asides.error, LEARN_SCHEMA);
  if (asides.error) throw fail('Reading what you pushed aside', asides.error);

  // A question written ahead and never shown is a row too, and says nothing
  // about what you did.
  const rows = ((probes.data ?? []) as ProbeRow[]).filter(
    (row) => row.picked_state === null || row.shown_at !== null,
  );
  const pushed = ((asides.data ?? []) as { concept_id: string }[]).map((row) => row.concept_id);

  const conceptIds = [...new Set([...rows.map((row) => row.concept_id), ...pushed])];
  const subjectOf = new Map<string, string>();
  if (conceptIds.length > 0) {
    let conceptQuery = supabase.from('concepts').select('id, subject_id').in('id', conceptIds);
    if (userId) conceptQuery = conceptQuery.eq('user_id', userId);
    const [{ data, error }, surveyed] = await Promise.all([
      conceptQuery,
      loadSurveySubjectIds(supabase, userId),
    ]);
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail('Reading which track those ideas are in', error);
    for (const concept of (data ?? []) as { id: string; subject_id: string }[]) {
      // A survey question is not a track's (plan #838): it neither weighs as
      // a track nor counts as answering elsewhere.
      if (surveyed.has(concept.subject_id)) continue;
      subjectOf.set(concept.id, concept.subject_id);
    }
  }

  // The question shown last is the one on the screen, or the one just
  // answered. Any unanswered question shown before it was moved past.
  const lastShown = rows.reduce<string | null>(
    (latest, row) =>
      row.shown_at !== null && (latest === null || row.shown_at > latest) ? row.shown_at : latest,
    null,
  );

  const activity = new Map<string, TrackActivity>();
  const asked = new Map<string, number>();
  const of = (subjectId: string) => {
    const found = activity.get(subjectId);
    if (found) return found;
    const fresh = blank();
    activity.set(subjectId, fresh);
    return fresh;
  };
  const inWindow = (at: string | null) => at !== null && new Date(at).getTime() >= windowStart;

  for (const row of rows) {
    const subjectId = subjectOf.get(row.concept_id);
    if (!subjectId) continue;
    const track = of(subjectId);

    if (row.answered_at !== null) {
      if (inWindow(row.answered_at)) track.answered += 1;
      else track.answeredBefore += 1;
    } else if (inWindow(row.shown_at) && row.shown_at !== lastShown) {
      track.skipped += 1;
    }

    if (inWindow(row.answered_at) || inWindow(row.shown_at)) {
      asked.set(subjectId, (asked.get(subjectId) ?? 0) + 1);
    }
  }

  for (const conceptId of pushed) {
    const subjectId = subjectOf.get(conceptId);
    if (subjectId) of(subjectId).pushedAside += 1;
  }

  return { activity, weights: trackWeights(activity), asked };
}

/**
 * The shares the mixed flow picks by. `waiting` is questions written ahead
 * and not yet shown, by track: they will be asked, so they count as asked.
 */
export function sharesFrom(
  interest: TrackInterest,
  waiting: ReadonlyMap<string, number> = new Map(),
): TrackShare[] {
  const ids = new Set([...interest.weights.keys(), ...interest.asked.keys(), ...waiting.keys()]);
  return [...ids].map((subjectId) => ({
    subjectId,
    weight: interest.weights.get(subjectId)?.weight ?? 1,
    asked: (interest.asked.get(subjectId) ?? 0) + (waiting.get(subjectId) ?? 0),
  }));
}

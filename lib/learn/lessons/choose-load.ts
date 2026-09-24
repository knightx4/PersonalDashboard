import 'server-only';

import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadTrackInterest } from '@/lib/learn/flow/interest-load';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';
import { loadGoals, loadGraph, loadSubjects } from '@/lib/learn/graph/load';
import { chooseLessons, type ChooseLessonsInput, type LessonChoice } from './choose';

/**
 * Reading what `chooseLessons` needs (plan #975).
 *
 * The Learn now top-up runs with the service role, which RLS does not narrow,
 * so every read here names the person by `userId`. The graph, goal,
 * curriculum and interest readers are the ones the pages use through the
 * session client; each takes an optional `userId` for this and adds
 * `user_id = userId` to every query when it is given. Survey subjects are left
 * out by `loadSubjects`, and `loadTrackInterest` already ignores them.
 *
 * One read per track for its graph, goals and curriculum, as `/learn/know`
 * does, and no model call.
 */

/** Cards a lesson can no longer be for: the writer dropped them unseen. */
const UNSEEN_STATUS = 'dropped';

/** Card statuses still in the deck, waiting to be written or shown. */
const IN_DECK = new Set(['picked', 'ready']);

type CardRow = { concept_id: string; status: string };

/** Every track, weighed, with its units, goals and graph, and the concepts on cards. */
export async function loadLessonInput(
  supabase: LearnSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<Omit<ChooseLessonsInput, 'slots'>> {
  const [subjects, interest, cards] = await Promise.all([
    loadSubjects(supabase, userId),
    loadTrackInterest(supabase, now, userId),
    readAll<CardRow>((from, to) =>
      supabase
        .from('feed_cards')
        .select('concept_id, status')
        .eq('user_id', userId)
        .not('concept_id', 'is', null)
        .neq('status', UNSEEN_STATUS)
        .order('id')
        .range(from, to),
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Reading the concepts already on cards failed: ${message}`);
    }),
  ]);

  const tracks = await Promise.all(
    subjects.map(async (subject) => {
      const [graph, goals, units] = await Promise.all([
        loadGraph(supabase, subject.id, userId),
        loadGoals(supabase, subject.id, userId),
        loadCurriculum(supabase, subject.id, userId),
      ]);
      return { subjectId: subject.id, name: subject.name, units, goals, graph };
    }),
  );

  const subjectOf = new Map<string, string>();
  for (const track of tracks) {
    for (const concept of track.graph.concepts) subjectOf.set(concept.id, track.subjectId);
  }
  const dealt = new Map<string, number>();
  for (const card of cards) {
    const subjectId = subjectOf.get(card.concept_id);
    if (subjectId && IN_DECK.has(card.status)) dealt.set(subjectId, (dealt.get(subjectId) ?? 0) + 1);
  }

  return {
    tracks,
    weights: interest.weights,
    carded: new Set(cards.map((card) => card.concept_id)),
    dealt,
  };
}

/** The lessons for `slots` Learn now slots, read and chosen in one call. */
export async function chooseLessonsFor(
  supabase: LearnSupabaseClient,
  userId: string,
  slots: number,
  now: Date = new Date(),
): Promise<LessonChoice> {
  const input = await loadLessonInput(supabase, userId, now);
  return chooseLessons({ ...input, slots });
}

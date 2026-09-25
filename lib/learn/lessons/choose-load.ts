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

/**
 * Cards a lesson can still be written for: the writer dropped them unseen. A
 * dropped lesson is the exception and still counts as carded, because the
 * same concept would be dropped again for the same reason (plan #978).
 */
const UNSEEN_STATUS = 'dropped';

/** Card statuses still in the deck, waiting to be written or shown. */
const IN_DECK = new Set(['picked', 'ready']);

type CardRow = { concept_id: string; status: string; reason: string; difficulty: string | null };

/**
 * One person's tracks whose units are not to be laid out before a time: the
 * top-up tried and failed, or found no unit to open (plan #978). Read here
 * rather than in `loadSubjects`, which the pages share.
 */
async function loadHeld(supabase: LearnSupabaseClient, userId: string, now: Date): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id')
    .eq('user_id', userId)
    .gt('lessons_held_until', now.toISOString());
  if (error) throw new Error(`Reading which tracks are held failed: ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

/** Units that already have a check card, whatever became of it (plan #971). */
async function loadChecked(supabase: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const rows = await readAll<{ unit_id: string }>((from, to) =>
    supabase
      .from('feed_cards')
      .select('unit_id')
      .eq('user_id', userId)
      .eq('reason', 'unit_check')
      .not('unit_id', 'is', null)
      .order('id')
      .range(from, to),
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Reading which units have a check failed: ${message}`);
  });
  return new Set(rows.map((row) => row.unit_id));
}

/**
 * Every track, weighed, with its units, goals and graph, the concepts on
 * cards, the concepts whose lesson was rated too hard, and the units that
 * already have a check.
 */
export async function loadLessonInput(
  supabase: LearnSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<Omit<ChooseLessonsInput, 'slots'>> {
  const [subjects, interest, cards, checked] = await Promise.all([
    loadSubjects(supabase, userId),
    loadTrackInterest(supabase, now, userId),
    readAll<CardRow>((from, to) =>
      supabase
        .from('feed_cards')
        .select('concept_id, status, reason, difficulty')
        .eq('user_id', userId)
        .not('concept_id', 'is', null)
        .or(`status.neq.${UNSEEN_STATUS},reason.eq.lesson`)
        .order('id')
        .range(from, to),
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Reading the concepts already on cards failed: ${message}`);
    }),
    loadChecked(supabase, userId),
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
    tooHard: new Set(
      cards.filter((card) => card.reason === 'lesson' && card.difficulty === 'too_hard').map((card) => card.concept_id),
    ),
    dealt,
    checked,
  };
}

/**
 * The lessons for `slots` Learn now slots, read and chosen in one call.
 *
 * A track under a hold (`lessons_held_until` in the future) still has its
 * ready concepts taught, since the hold is about laying out units; only its
 * need is left out of `needs`, and its id is listed in `held`.
 */
export async function chooseLessonsFor(
  supabase: LearnSupabaseClient,
  userId: string,
  slots: number,
  now: Date = new Date(),
): Promise<LessonChoice & { held: string[] }> {
  const [input, heldIds] = await Promise.all([loadLessonInput(supabase, userId, now), loadHeld(supabase, userId, now)]);
  const choice = chooseLessons({ ...input, slots });
  const held = choice.needs.filter((need) => heldIds.has(need.subjectId)).map((need) => need.subjectId);
  return { ...choice, needs: choice.needs.filter((need) => !heldIds.has(need.subjectId)), held };
}

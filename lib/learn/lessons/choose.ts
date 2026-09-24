import { trackToAsk, type TrackShare, type TrackWeight } from '@/lib/learn/flow/interest';
import { curriculumRows, type UnitGoal } from '@/lib/learn/graph/curriculum-view';
import { pruneForGoal, type Concept, type Graph } from '@/lib/learn/graph/model';
import { rankReady, readyInSubject } from '@/lib/learn/graph/ready';

/**
 * Which concept in which track each Learn now lesson slot teaches
 * (LEARN-LESSONS-SPEC, "How slots are shared between tracks" and "The next
 * lesson in a track"). No model call: everything here is read off the graph
 * and the Practice Flow weights. Pure, so the choice is testable against
 * tracks written by hand; the reading that feeds it is `choose-load.ts`.
 *
 * The rules come from the helpers the rest of Learn already uses, so a lesson
 * and a Practice Flow question agree on what "ready" means:
 *
 * - The track's weight and whether it has stopped come from `trackWeights`
 *   (`lib/learn/flow/interest.ts`). A stopped track is dormant here and takes
 *   no slot. `stopped` already says "nothing answered in the four weeks, some
 *   answered before them, and other tracks answered in them", which is the
 *   spec's dormant with one difference: a track never used at all is not
 *   dormant. Lessons are how an untouched track gets its first use, and
 *   nothing records a track being opened yet, so hiding one would leave no way
 *   back in from Learn now.
 * - The unit is the first one that is not done, as `curriculumRows` reads it
 *   for the track's page.
 * - Inside the unit, the concepts are the ones on the path to its goals
 *   (`pruneForGoal`) that `readyToLearn` allows: not known or sharp, with
 *   every prerequisite known or sharp. `rankReady` orders them, which puts the
 *   concept nearest the unit's outcome first, as the spec asks.
 * - Slots go to tracks by `trackToAsk`, the rule Practice Flow shares its
 *   questions by, so over a run of slots each track gets lessons in
 *   proportion to its weight.
 */

/** One track as the chooser needs it. */
export type LessonTrack = {
  subjectId: string;
  name: string;
  /** The curriculum's units, in its own order. Empty for a track with none. */
  units: readonly { id: string }[];
  /** Every goal in the track, with the unit it was opened from. */
  goals: readonly UnitGoal[];
  graph: Graph;
};

export type ChooseLessonsInput = {
  tracks: readonly LessonTrack[];
  /** From `trackWeights`. A track missing here weighs 1 and has not stopped. */
  weights: ReadonlyMap<string, TrackWeight>;
  /** Concepts that already have a card the person has seen or will see. */
  carded: ReadonlySet<string>;
  /**
   * Cards per track already waiting in the deck. They count as slots the
   * track has had, so a top-up does not pile more onto a track that is
   * already well represented.
   */
  dealt?: ReadonlyMap<string, number>;
  slots: number;
};

/** One slot's lesson: the concept to teach and where it sits. */
export type LessonPick = {
  subjectId: string;
  subjectName: string;
  unitId: string;
  concept: Concept;
  /** Edges up to the nearest of the unit's goals; 0 is a goal itself. */
  stepsToOutcome: number | null;
};

/**
 * A track with nothing to teach until something is written for it.
 *
 * - `no-chain`: the first unit that is not done has no goal resolved to a
 *   concept, so its chain has not been written. `unitId` is that unit, and
 *   `generateChain` for it is what comes next.
 * - `all-units-done`: every unit is done. `unitId` is the last one, and the
 *   next unit is written after it.
 * - `no-curriculum`: the track has no units at all, so `unitId` is null and
 *   the first unit is written. A track made before curricula existed can be
 *   in this state while its graph still holds concepts: they are not taught
 *   until a unit covers them, since a lesson always belongs to a unit.
 */
export type TrackNeed = {
  subjectId: string;
  subjectName: string;
  because: 'no-chain' | 'all-units-done' | 'no-curriculum';
  unitId: string | null;
};

export type LessonChoice = {
  /** At most `slots`, in the order the slots were filled. */
  picks: LessonPick[];
  needs: TrackNeed[];
  /** Tracks left out because they have stopped. Nothing is asked for them. */
  dormant: string[];
  /**
   * Tracks whose current unit has ready concepts, all of them already on a
   * card. Nothing needs writing: the next concept becomes ready once one of
   * those is known.
   */
  waiting: string[];
};

type TrackPlan =
  | { kind: 'teach'; candidates: LessonPick[] }
  | { kind: 'need'; need: TrackNeed }
  | { kind: 'waiting' };

/** What one track can teach next, before any slot is given out. */
export function planTrack(track: LessonTrack, carded: ReadonlySet<string>): TrackPlan {
  const need = (because: TrackNeed['because'], unitId: string | null): TrackPlan => ({
    kind: 'need',
    need: { subjectId: track.subjectId, subjectName: track.name, because, unitId },
  });

  if (track.units.length === 0) return need('no-curriculum', null);

  const { rows } = curriculumRows([...track.units], [...track.goals], track.graph);
  const current = rows.find((row) => row.next);
  if (!current) return need('all-units-done', track.units[track.units.length - 1].id);
  if (current.state === 'not-opened') return need('no-chain', current.unit.id);

  const goalConceptIds = current.goals.map((goal) => goal.conceptId!);
  const onPath = new Set(goalConceptIds.flatMap((id) => pruneForGoal(track.graph, id)));
  const ready = readyInSubject(
    track.graph,
    { id: track.subjectId, name: track.name },
    goalConceptIds,
  ).filter((row) => onPath.has(row.concept.id) && !carded.has(row.concept.id));

  if (ready.length === 0) return { kind: 'waiting' };
  return {
    kind: 'teach',
    candidates: rankReady(ready, ready.length).map((row) => ({
      subjectId: track.subjectId,
      subjectName: track.name,
      unitId: current.unit.id,
      concept: row.concept,
      stepsToOutcome: row.stepsToGoal,
    })),
  };
}

/**
 * The concept each of `slots` lessons teaches, and what the tracks that could
 * not be given one need.
 *
 * A track can fill several slots in a row when its unit has several ready
 * concepts, and a concept is never picked twice. Slots left over once every
 * track's ready concepts are used stay empty; the caller fills them with other
 * cards.
 */
export function chooseLessons(input: ChooseLessonsInput): LessonChoice {
  const dormant: string[] = [];
  const needs: TrackNeed[] = [];
  const waiting: string[] = [];
  const queues = new Map<string, LessonPick[]>();

  for (const track of input.tracks) {
    if (input.weights.get(track.subjectId)?.stopped) {
      dormant.push(track.subjectId);
      continue;
    }
    const plan = planTrack(track, input.carded);
    if (plan.kind === 'need') needs.push(plan.need);
    else if (plan.kind === 'waiting') waiting.push(track.subjectId);
    else queues.set(track.subjectId, plan.candidates);
  }

  const shares: TrackShare[] = [...queues.keys()].map((subjectId) => ({
    subjectId,
    weight: input.weights.get(subjectId)?.weight ?? 1,
    asked: input.dealt?.get(subjectId) ?? 0,
  }));

  const picks: LessonPick[] = [];
  while (picks.length < input.slots) {
    const open = [...queues].filter(([, queue]) => queue.length > 0).map(([id]) => id);
    const subjectId = trackToAsk(open, shares, false);
    if (subjectId === null) break;
    picks.push(queues.get(subjectId)!.shift()!);
    shares.find((share) => share.subjectId === subjectId)!.asked += 1;
  }

  return { picks, needs, dormant, waiting };
}

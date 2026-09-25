import { wantsGoal } from '@/lib/learn/feed/targets';
import { trackToAsk, type TrackShare, type TrackWeight } from '@/lib/learn/flow/interest';
import { curriculumRows, type UnitGoal } from '@/lib/learn/graph/curriculum-view';
import { pruneForGoal, type Concept, type Graph } from '@/lib/learn/graph/model';
import { rankReady, readyInSubject } from '@/lib/learn/graph/ready';
import { unitCheckDue, type UnitCheckDue } from './unit-check';

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
 * - A concept under a lesson rated too hard comes before the rest of its
 *   unit (plan #970): the top-up has added what that lesson rests on, and the
 *   spec asks for its lesson first.
 * - Slots go to tracks by `trackToAsk`, the rule Practice Flow shares its
 *   questions by, so over a run of slots each track gets lessons in
 *   proportion to its weight.
 * - The tracks of learning goals (plan #972) share one slot in three between
 *   them, the share a goal had of the section cards (`wantsGoal`, decision
 *   #899). The count is the cards waiting in the deck plus the slots filled
 *   in this run, so a goal set today gets its share from the next top-up.
 *   Within the goals' third, and among the other tracks for the rest, slots
 *   still go by weight. A goal track takes the other slots too when no other
 *   track has anything to teach, and the goals' third goes to the other
 *   tracks when no goal track has. A goal's track is never dormant while the
 *   goal is active: the person set it on purpose, as they start a track.
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
  /** Concepts whose lesson was rated too hard. What sits under them is taught first. */
  tooHard?: ReadonlySet<string>;
  /**
   * Cards per track already waiting in the deck. They count as slots the
   * track has had, so a top-up does not pile more onto a track that is
   * already well represented.
   */
  dealt?: ReadonlyMap<string, number>;
  /** Units that already have a check card, answered, skipped or waiting. */
  checked?: ReadonlySet<string>;
  /** The tracks of the person's active learning goals (plan #972). */
  goalTracks?: ReadonlySet<string>;
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
 * - `last-unit-short`: the track is on its last unit and fewer than
 *   `SHORT_UNIT_LEFT` of that unit's concepts are left to learn. The track
 *   still teaches what is left; `unitId` is the last unit, and the next unit
 *   is written after it so it is ready when this one is done.
 *
 * Every kind but `no-chain` is met by writing a unit (plan #969,
 * LEARN-LESSONS-SPEC "Units are written as you go"); `unitId` is then the
 * track's last unit when the need was read, so a writer can tell that another
 * run already added one.
 */
export type TrackNeed = {
  subjectId: string;
  subjectName: string;
  because: 'no-chain' | 'all-units-done' | 'no-curriculum' | 'last-unit-short';
  unitId: string | null;
};

/** A last unit with fewer concepts left than this gets the next unit written after it. */
export const SHORT_UNIT_LEFT = 3;

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
  /**
   * Tracks whose latest done unit has not been offered its check (plan #971),
   * one each. Dormant tracks are left out, as they are for lessons.
   */
  checks: UnitCheckDue[];
};

/**
 * A track that can teach, or is waiting, may still carry a need: its last
 * unit is running short, and the next unit is written while it is taught.
 */
type TrackPlan =
  | { kind: 'teach'; candidates: LessonPick[]; need?: TrackNeed }
  | { kind: 'need'; need: TrackNeed }
  | { kind: 'waiting'; need?: TrackNeed };

/**
 * The concepts under a lesson rated too hard: everything on the path to a
 * too-hard concept that is not settled, other than the concept itself.
 */
function underTooHard(graph: Graph, tooHard: ReadonlySet<string>): Set<string> {
  const under = new Set<string>();
  for (const id of tooHard) {
    for (const below of pruneForGoal(graph, id)) if (below !== id) under.add(below);
  }
  return under;
}

/** What one track can teach next, before any slot is given out. */
export function planTrack(
  track: LessonTrack,
  carded: ReadonlySet<string>,
  tooHard: ReadonlySet<string> = new Set(),
): TrackPlan {
  const need = (because: TrackNeed['because'], unitId: string | null): TrackPlan => ({
    kind: 'need',
    need: { subjectId: track.subjectId, subjectName: track.name, because, unitId },
  });

  if (track.units.length === 0) return need('no-curriculum', null);

  const { rows } = curriculumRows([...track.units], [...track.goals], track.graph);
  const current = rows.find((row) => row.next);
  if (!current) return need('all-units-done', track.units[track.units.length - 1].id);
  if (current.state === 'not-opened') return need('no-chain', current.unit.id);

  const last = track.units[track.units.length - 1];
  const short =
    current.unit.id === last.id && current.left < SHORT_UNIT_LEFT
      ? { need: { subjectId: track.subjectId, subjectName: track.name, because: 'last-unit-short' as const, unitId: last.id } }
      : {};

  const goalConceptIds = current.goals.map((goal) => goal.conceptId!);
  const onPath = new Set(goalConceptIds.flatMap((id) => pruneForGoal(track.graph, id)));
  const ready = readyInSubject(
    track.graph,
    { id: track.subjectId, name: track.name },
    goalConceptIds,
  ).filter((row) => onPath.has(row.concept.id) && !carded.has(row.concept.id));

  if (ready.length === 0) return { kind: 'waiting', ...short };
  const under = underTooHard(track.graph, tooHard);
  const ranked = rankReady(ready, ready.length);
  const first = ranked.filter((row) => under.has(row.concept.id));
  return {
    kind: 'teach',
    ...short,
    candidates: [...first, ...ranked.filter((row) => !under.has(row.concept.id))].map((row) => ({
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
  const checks: UnitCheckDue[] = [];
  const queues = new Map<string, LessonPick[]>();

  const goalTracks = input.goalTracks ?? new Set<string>();
  for (const track of input.tracks) {
    if (input.weights.get(track.subjectId)?.stopped && !goalTracks.has(track.subjectId)) {
      dormant.push(track.subjectId);
      continue;
    }
    const check = unitCheckDue(track, input.checked ?? new Set());
    if (check) checks.push(check);
    const plan = planTrack(track, input.carded, input.tooHard);
    if (plan.need) needs.push(plan.need);
    if (plan.kind === 'waiting') waiting.push(track.subjectId);
    else if (plan.kind === 'teach') queues.set(track.subjectId, plan.candidates);
  }

  const shares: TrackShare[] = [...queues.keys()].map((subjectId) => ({
    subjectId,
    weight: input.weights.get(subjectId)?.weight ?? 1,
    asked: input.dealt?.get(subjectId) ?? 0,
  }));

  // The goals' share counts every track's waiting cards, not only the tracks
  // with something to teach now.
  const goalCount = { goal: 0, total: 0 };
  for (const [subjectId, count] of input.dealt ?? []) {
    goalCount.total += count;
    if (goalTracks.has(subjectId)) goalCount.goal += count;
  }

  const picks: LessonPick[] = [];
  while (picks.length < input.slots) {
    const open = [...queues].filter(([, queue]) => queue.length > 0).map(([id]) => id);
    const subjectId = trackToAsk(goalTurn(open, goalTracks, goalCount), shares, false);
    if (subjectId === null) break;
    picks.push(queues.get(subjectId)!.shift()!);
    shares.find((share) => share.subjectId === subjectId)!.asked += 1;
    goalCount.total += 1;
    if (goalTracks.has(subjectId)) goalCount.goal += 1;
  }

  return { picks, needs, dormant, waiting, checks };
}

/**
 * The tracks the next slot may go to: the goal tracks when the goals are at or
 * behind their one in three, the others when they are ahead, and whichever
 * side has something to teach when only one does.
 */
function goalTurn(
  open: readonly string[],
  goalTracks: ReadonlySet<string>,
  share: { goal: number; total: number },
): readonly string[] {
  const goals = open.filter((id) => goalTracks.has(id));
  const others = open.filter((id) => !goalTracks.has(id));
  if (goals.length === 0 || others.length === 0) return open;
  return wantsGoal(share) ? goals : others;
}

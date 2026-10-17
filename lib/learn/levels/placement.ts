/**
 * A placement before a subject's first lesson (plan #2292.2;
 * docs/LEARN-LEVELS-SPEC.md, "Choosing the next question"). Pure.
 *
 * A placement is a Practice Flow run scoped to the subject's lens that asks
 * nothing but placement: up to `PLACEMENT_QUESTIONS` questions, taking the
 * subject's topics in order and bisecting each topic's levels by the rule in
 * model.ts `nextQuestion`, before moving to the next topic. Its end marks
 * every piece of the laid-out units whose matched cells are all held as held
 * (plan #2292.5): the piece is not passed or skipped, but opens with its
 * lessons folded and its check asked a level higher. The lesson it opens is
 * the first piece not passed, held or not.
 *
 * The order is the one the lessons teach in: topics as the laid-out pieces
 * first name them (unit by unit, piece by piece), then the rest of the lens
 * in the order its topics joined it.
 */

import { isHeld, nextQuestion, readCells, topicLevel, type Readings, type TopicMap } from '@/lib/learn/levels/model';
import { ASK_CEILING, restingCells, withoutRestingDoubt, type PickedCell } from '@/lib/learn/levels/pick';

/** The most questions a placement asks. */
export const PLACEMENT_QUESTIONS = 8;

export type PlacementPiece = {
  id: string;
  /** Its unit's place in the subject's plan. */
  unitOrdinal: number;
  /** Its place in the unit. */
  ordinal: number;
  title: string;
  /** The cells it was matched to teach, in the matcher's order. */
  cellIds: readonly string[];
  passed: boolean;
  /** A placement showed every cell it teaches as held (plan #2292.5). */
  held: boolean;
};

/** Pieces in teaching order: unit by unit, then piece by piece. */
export function inTeachingOrder<T extends Pick<PlacementPiece, 'unitOrdinal' | 'ordinal'>>(pieces: readonly T[]): T[] {
  return [...pieces].sort((a, b) => a.unitOrdinal - b.unitOrdinal || a.ordinal - b.ordinal);
}

/**
 * The lens's topics in the order placement takes them: as the pieces first
 * name them, then the lens's others in the order given.
 */
export function placementOrder(
  lensTopics: readonly string[],
  pieces: readonly PlacementPiece[],
  cellTopic: ReadonlyMap<string, string>,
): string[] {
  const inLens = new Set(lensTopics);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (topicId: string | undefined) => {
    if (topicId && inLens.has(topicId) && !seen.has(topicId)) {
      seen.add(topicId);
      out.push(topicId);
    }
  };
  for (const piece of inTeachingOrder(pieces)) for (const cellId of piece.cellIds) add(cellTopic.get(cellId));
  for (const topicId of lensTopics) add(topicId);
  return out;
}

/**
 * The next placement question, or null when the run has asked its eight or
 * no topic in the order has a level left to place. A topic is placed to the
 * end before the next is started; a level answered in the rest window is not
 * asked again, so a topic whose next level is resting is passed over.
 */
export function pickPlacement(
  full: TopicMap,
  options: { order: readonly string[]; now: Date; asked: number },
): PickedCell | null {
  if (options.asked >= PLACEMENT_QUESTIONS) return null;
  const readings = readCells(full);
  const map: TopicMap = {
    ...full,
    topics: full.topics.map((t) => ({ ...t, ceiling: Math.min(t.ceiling, ASK_CEILING) })),
  };
  const resting = restingCells(map, options.now);
  const asking = withoutRestingDoubt(readings, resting);
  const topics = new Map(map.topics.map((t) => [t.id, t]));
  for (const topicId of options.order) {
    const topic = topics.get(topicId);
    if (!topic?.approved) continue;
    const q = nextQuestion(map, asking, topicId);
    if (!q || (q.reason !== 'placement' && q.reason !== 'doubt') || resting.has(q.cellId)) continue;
    return {
      cellId: q.cellId,
      topicId,
      topicName: topic.name,
      level: q.level,
      reason: q.reason,
      heldTo: topicLevel(map, readings, topicId).level,
      missed: false,
      direction: null,
      unlocks: 0,
      heldSince: null,
    };
  }
  return null;
}

/**
 * The pieces neither passed nor already held whose matched cells are all
 * held. A piece with no cells on the map says nothing about what you hold, so
 * it is never held this way.
 */
export function heldPieces(pieces: readonly PlacementPiece[], readings: Readings): string[] {
  return pieces
    .filter((piece) => {
      if (piece.passed || piece.held) return false;
      const cells = piece.cellIds.filter((id) => readings.has(id));
      return cells.length > 0 && cells.every((id) => isHeld(readings.get(id)!.status));
    })
    .map((piece) => piece.id);
}

/**
 * The first piece in teaching order not passed, held or not: where the
 * lessons start. A placement holds pieces rather than passing them, so after
 * one this is still unit 1's first piece until a check passes it.
 */
export function firstNotHeld<T extends Pick<PlacementPiece, 'unitOrdinal' | 'ordinal' | 'passed'>>(
  pieces: readonly T[],
): T | null {
  return inTeachingOrder(pieces).find((piece) => !piece.passed) ?? null;
}

export type PlacedTopic = {
  topicId: string;
  name: string;
  /** The top of the unbroken run of held levels from 1; 0 when level 1 is not held. */
  level: number;
};

/** The topics a run answered on, in placement order, with the level each now stands at. */
export function placedTopics(map: TopicMap, readings: Readings, order: readonly string[], since: string): PlacedTopic[] {
  const topicOf = new Map(map.cells.map((c) => [c.id, c.topicId]));
  const answered = new Set<string>();
  for (const row of map.evidence) {
    const topicId = topicOf.get(row.cellId);
    if (topicId && new Date(row.observedAt).toISOString() >= since) answered.add(topicId);
  }
  const names = new Map(map.topics.map((t) => [t.id, t.name]));
  return order
    .filter((id) => answered.has(id))
    .map((topicId) => ({ topicId, name: names.get(topicId) ?? '', level: topicLevel(map, readings, topicId).level }));
}

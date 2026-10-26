/**
 * The one thing to learn next, chosen for you (plan #2546.2).
 *
 * Learn's Start button and the Next that follows each item ask this for one
 * item, so nothing has to be picked first. The order:
 *
 * 1. A review question that is due (`loadDueReviews`'s order, most overdue
 *    first, two ideas from one piece kept apart).
 * 2. The piece you are on: its next unread lesson, then its check, then its
 *    practice task. A subject is one you are on once you have read a lesson
 *    in it, asked a check or handed in a task; among those, a subject an
 *    open goal points at comes first, then the one worked on most recently.
 * 3. A practice question on the fringe of any approved topic, whether from
 *    your subjects or from an area such as the business pack, by the levels
 *    pick rules (`pickCell`: a re-check one answer in five, placement, misses
 *    first). When those rules find nothing only because the levels left are
 *    resting after an answer, the lowest of them is asked anyway, so the
 *    session never ends while a level can still be asked.
 * 4. The first piece of the next ready subject you have not started, in the
 *    same subject order.
 *
 * Null only when there is no review due, no piece left in any subject, and
 * every level of every approved topic up to `ASK_CEILING` is held. Level 10 is
 * a defence, which the flow cannot ask yet, so it is not counted.
 *
 * `skip` holds the keys of items passed over in this session, so Next moves on
 * from one you did not want rather than handing it straight back.
 *
 * Pure: the reads are `choose-store.ts`.
 */

import type { DueReview } from '@/lib/learn/lessons/review';
import { ASK_CEILING, pickCell, whyLine, type PickedCell } from '@/lib/learn/levels/pick';
import { isHeld, readCells, topicLevel, type TopicMap } from '@/lib/learn/levels/model';

/** One idea of a piece and whether its lesson has been read. */
export type SessionLesson = {
  conceptId: string;
  name: string;
  /** The lesson card, or null when none is written yet; the player writes it. */
  cardId: string | null;
  read: boolean;
};

/** A piece of a subject's plan, with how far each half of it has got. */
export type SessionPiece = {
  id: string;
  title: string;
  passed: boolean;
  /** A placement showed every cell it teaches is held, so its lessons are not read again. */
  held: boolean;
  /** Ideas in the piece's order. A lesson the writer declined is left out by the loader. */
  lessons: SessionLesson[];
  /** The newest check asked and not answered, shown again rather than written twice. */
  openCheckId: string | null;
  /** A check has been asked, so the lessons were read on the piece's page or on Now. */
  checkAsked: boolean;
  checkPassed: boolean;
  /** The practice task, or null when none is written yet. */
  taskId: string | null;
  taskPassed: boolean;
};

/** A subject whose plan has pieces to work through. */
export type SessionSubject = {
  id: string;
  name: string;
  /** The open goal that points at it, or null for a prepared subject with none. */
  aimId: string | null;
  /** The newest lesson read, check asked or task handed in, or null for never. */
  lastWorked: string | null;
  /** Units by their ordinal, then pieces by theirs. */
  pieces: SessionPiece[];
};

export type ChooseNextInput = {
  /** Due reviews, in the order `loadDueReviews` gives them. */
  reviews: readonly DueReview[];
  subjects: readonly SessionSubject[];
  /** The topic map, drafts included; only approved topics are asked about. */
  map: TopicMap;
  /** Cell questions answered so far, for the re-check turn. */
  answered: number;
  /** Target level per topic, from the lenses. */
  lensTargets?: ReadonlyMap<string, number>;
  /** Keys of items passed over in this session. */
  skip?: ReadonlySet<string>;
  now: Date;
};

/** Where a lesson, check or task sits. */
export type PiecePlace = {
  subjectId: string;
  subjectName: string;
  aimId: string | null;
  pieceId: string;
  pieceTitle: string;
  /** The first piece of a subject not started yet (step 4), not the one you are on. */
  starting: boolean;
};

export type NextItem =
  | { kind: 'review'; key: string; review: DueReview }
  | (PiecePlace & { kind: 'lesson'; key: string; conceptId: string; conceptName: string; cardId: string | null })
  | (PiecePlace & { kind: 'check'; key: string; checkId: string | null })
  | (PiecePlace & { kind: 'task'; key: string; taskId: string | null })
  | { kind: 'question'; key: string; cell: PickedCell; why: string };

export type NextItemKind = NextItem['kind'];

export function reviewKey(conceptId: string): string {
  return `review:${conceptId}`;
}

export function lessonKey(pieceId: string, conceptId: string): string {
  return `lesson:${pieceId}:${conceptId}`;
}

export function checkKey(pieceId: string): string {
  return `check:${pieceId}`;
}

export function taskKey(pieceId: string): string {
  return `task:${pieceId}`;
}

export function questionKey(cellId: string): string {
  return `question:${cellId}`;
}

/** A subject you have read, answered or handed in something in. */
export function subjectStarted(subject: SessionSubject): boolean {
  return subject.lastWorked !== null;
}

/** A goal's subject first, then the one worked on most recently, then as given. */
export function orderSubjects(subjects: readonly SessionSubject[]): SessionSubject[] {
  return subjects
    .map((subject, index) => ({ subject, index }))
    .sort((a, b) => {
      const goal = Number(b.subject.aimId !== null) - Number(a.subject.aimId !== null);
      if (goal !== 0) return goal;
      const at = a.subject.lastWorked ?? '';
      const bt = b.subject.lastWorked ?? '';
      if (at !== bt) return at < bt ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ subject }) => subject);
}

/**
 * A piece's lessons all count as read once its check was asked or its task
 * passed, which happen after the lessons wherever the piece was worked, or once
 * a placement held it. Before that, each lesson's own card says.
 */
function lessonsDone(piece: SessionPiece): boolean {
  return piece.held || piece.checkAsked || piece.taskPassed;
}

/**
 * The next thing in one piece: an unread lesson, then the check, then the
 * task. Null for a passed piece, or one whose every part is skipped.
 */
export function pieceStep(
  subject: SessionSubject,
  piece: SessionPiece,
  starting: boolean,
  skip: ReadonlySet<string>,
): NextItem | null {
  if (piece.passed) return null;
  const place: PiecePlace = {
    subjectId: subject.id,
    subjectName: subject.name,
    aimId: subject.aimId,
    pieceId: piece.id,
    pieceTitle: piece.title,
    starting,
  };

  if (!lessonsDone(piece)) {
    const lesson = piece.lessons.find((one) => !one.read && !skip.has(lessonKey(piece.id, one.conceptId)));
    if (lesson) {
      return {
        ...place,
        kind: 'lesson',
        key: lessonKey(piece.id, lesson.conceptId),
        conceptId: lesson.conceptId,
        conceptName: lesson.name,
        cardId: lesson.cardId,
      };
    }
  }
  if (!piece.checkPassed && !skip.has(checkKey(piece.id))) {
    return { ...place, kind: 'check', key: checkKey(piece.id), checkId: piece.openCheckId };
  }
  if (!piece.taskPassed && !skip.has(taskKey(piece.id))) {
    return { ...place, kind: 'task', key: taskKey(piece.id), taskId: piece.taskId };
  }
  return null;
}

/** The first step in a subject's pieces, in their order. */
function subjectStep(subject: SessionSubject, starting: boolean, skip: ReadonlySet<string>): NextItem | null {
  for (const piece of subject.pieces) {
    const step = pieceStep(subject, piece, starting, skip);
    if (step) return step;
  }
  return null;
}

/**
 * The lowest level not held on any approved topic, resting or not: what is
 * asked when the pick rules find nothing only because of the rest window.
 */
function anyUnheldCell(map: TopicMap, skip: ReadonlySet<string>): PickedCell | null {
  const readings = readCells(map);
  const topics = [...map.topics].filter((t) => t.approved).sort((a, b) => a.name.localeCompare(b.name));
  for (const topic of topics) {
    const ceiling = Math.min(topic.ceiling, ASK_CEILING);
    const cell = map.cells
      .filter((c) => c.topicId === topic.id && c.level <= ceiling)
      .filter((c) => !isHeld(readings.get(c.id)?.status ?? 'open') && !skip.has(questionKey(c.id)))
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))[0];
    if (cell) {
      const missed = readings.get(cell.id)?.status === 'missed';
      return {
        cellId: cell.id,
        topicId: topic.id,
        topicName: topic.name,
        level: cell.level,
        reason: missed ? 'fringe' : 'settle',
        heldTo: topicLevel(map, readings, topic.id).level,
        missed,
        direction: missed ? 'deeper' : null,
        unlocks: 0,
        heldSince: null,
      };
    }
  }
  return null;
}

/** A practice question on any approved topic, or null when every askable level is held. */
export function practiceQuestion(input: ChooseNextInput, skip: ReadonlySet<string>): NextItem | null {
  const picked = pickCell(input.map, { now: input.now, answered: input.answered, lensTargets: input.lensTargets });
  const cell = picked && !skip.has(questionKey(picked.cellId)) ? picked : anyUnheldCell(input.map, skip);
  return cell ? { kind: 'question', key: questionKey(cell.cellId), cell, why: whyLine(cell, input.now) } : null;
}

export function chooseNext(input: ChooseNextInput): NextItem | null {
  const skip = input.skip ?? new Set<string>();

  // 1. A due review.
  const review = input.reviews.find((one) => !skip.has(reviewKey(one.conceptId)));
  if (review) return { kind: 'review', key: reviewKey(review.conceptId), review };

  // 2. The piece you are on.
  const ordered = orderSubjects(input.subjects);
  for (const subject of ordered.filter(subjectStarted)) {
    const step = subjectStep(subject, false, skip);
    if (step) return step;
  }

  // 3. A practice question on the fringe of any approved topic.
  const question = practiceQuestion(input, skip);
  if (question) return question;

  // 4. The first piece of the next ready subject.
  for (const subject of ordered.filter((one) => !subjectStarted(one))) {
    const step = subjectStep(subject, true, skip);
    if (step) return step;
  }
  return null;
}

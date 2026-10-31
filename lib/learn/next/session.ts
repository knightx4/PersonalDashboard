/**
 * A learning session (plan #2546.3): one item at a time on /learn/go, each
 * the one `chooseNext` picks, made ready to show before it is asked for.
 *
 * `SessionItem` is a `NextItem` with what its screen draws: the review's
 * question asked, the lesson written, the check asked, the task written, the
 * level question written. One that could not be made ready is `failed`, and
 * Next passes over it. Pure: the writing is in app/learn/go/actions.ts.
 *
 * A new kind of item is a new member here, a case in the action's
 * `prepare` and a case in the session's `ItemBody`; each switch ends on
 * `never`, so the compiler names every place that has to learn it.
 */

import type { AskedCellView } from '@/components/learn/cell-answer-view';
import type { PieceCheck } from '@/lib/learn/lessons/piece-check';
import type { PieceIdea } from '@/lib/learn/lessons/piece-store';
import type { PracticeView } from '@/lib/learn/lessons/practice';
import type { DueReview } from '@/lib/learn/lessons/review';
import type { LevelLesson } from '@/lib/learn/levels/level-lesson-store';
import type { NextItem, NextItemKind } from './choose';

/**
 * What a session plays: everything the chooser picks (`chooseNext`), or
 * lessons only (`chooseLesson`), for Quick learn on Now.
 */
export type SessionMode = 'all' | 'lessons';

/** The session's address for a mode. */
export function sessionHref(mode: SessionMode): string {
  return mode === 'lessons' ? '/learn/go?only=lessons' : '/learn/go';
}

/** Where a lesson, check or task sits, for its presses. */
export type SessionPiece = { subjectId: string; pieceId: string };

export type SessionItem =
  | { kind: 'review'; key: string; line: string; review: DueReview }
  | (SessionPiece & { kind: 'lesson'; key: string; line: string; idea: PieceIdea; number: number })
  | (SessionPiece & {
      kind: 'check';
      key: string;
      line: string;
      check: PieceCheck;
      practicePassed: boolean;
    })
  | (SessionPiece & { kind: 'task'; key: string; line: string; practice: PracticeView; checkPassed: boolean })
  | { kind: 'question'; key: string; line: string; asked: AskedCellView }
  /** A topic level's lesson before its first question (plan #2546.5), always with a lesson to read. */
  | { kind: 'level_lesson'; key: string; line: string; lesson: LevelLesson & { lesson: NonNullable<LevelLesson['lesson']> } }
  | { kind: 'failed'; key: string; line: string; was: NextItemKind; error: string };

export type SessionItemKind = SessionItem['kind'];

/** What asking for the next item came back with: an item, nothing left, or a read that failed. */
export type SessionStep = { ok: true; item: SessionItem | null } | { ok: false; error: string };

/** What each kind is called on the line above it. */
export const KIND_WORD: Record<NextItemKind, string> = {
  review: 'Review',
  lesson: 'Lesson',
  check: 'Check',
  task: 'Practice',
  question: 'Question',
  level_lesson: 'Lesson',
};

/**
 * The one line saying what an item belongs to: the subject and piece for a
 * lesson, check or task, the subject and piece that taught a review, and the
 * topic and level for a question.
 */
export function placeLine(item: NextItem): string {
  switch (item.kind) {
    case 'review':
      return [item.review.trackName, item.review.pieceTitle].filter(Boolean).join(' · ');
    case 'lesson':
    case 'check':
    case 'task':
      return `${item.subjectName} · ${item.pieceTitle}`;
    case 'question':
      return `${item.cell.topicName} · level ${item.cell.level}`;
    case 'level_lesson':
      // The card's title names the level.
      return item.cell.topicName;
    default: {
      const unknown: never = item;
      return String(unknown);
    }
  }
}

/**
 * What the Start press on Now says it will open with (plan #2546.4): the
 * kind and a title, and where it sits. Described from what `chooseNext`
 * returned, so nothing is written to say it.
 */
export type StartLine = { kind: NextItemKind; word: string; title: string; place: string };

export function startLine(item: NextItem): StartLine {
  const word = KIND_WORD[item.kind];
  const place = placeLine(item);
  switch (item.kind) {
    case 'review':
      return { kind: item.kind, word, title: item.review.name, place };
    case 'lesson':
      return { kind: item.kind, word, title: item.conceptName, place };
    case 'check':
      return { kind: item.kind, word, title: item.pieceTitle, place: item.subjectName };
    case 'task':
      return { kind: item.kind, word, title: item.pieceTitle, place: item.subjectName };
    case 'question':
      return { kind: item.kind, word, title: item.cell.topicName, place: `Level ${item.cell.level}` };
    case 'level_lesson':
      return { kind: item.kind, word, title: item.cell.topicName, place: `Level ${item.cell.level}` };
    default: {
      const unknown: never = item;
      return unknown;
    }
  }
}

/** Items gone through in a session, by kind. */
export type SessionTally = Partial<Record<NextItemKind, number>>;

/** The kind an item counts as in the tally: a level's lesson as a lesson, a failed one as nothing. */
export function tallyKind(item: SessionItem): NextItemKind | null {
  if (item.kind === 'failed') return null;
  return item.kind === 'level_lesson' ? 'lesson' : item.kind;
}

export function addToTally(tally: SessionTally, kind: NextItemKind | null): SessionTally {
  return kind ? { ...tally, [kind]: (tally[kind] ?? 0) + 1 } : tally;
}

export function tallyTotal(tally: SessionTally): number {
  return Object.values(tally).reduce((sum, n) => sum + (n ?? 0), 0);
}

const TALLY_ORDER: Array<{ kind: NextItemKind; one: string; many: string }> = [
  { kind: 'lesson', one: 'a lesson', many: 'lessons' },
  { kind: 'check', one: 'a check', many: 'checks' },
  { kind: 'task', one: 'a practice task', many: 'practice tasks' },
  { kind: 'question', one: 'a question', many: 'questions' },
  { kind: 'review', one: 'a review', many: 'reviews' },
];

/** One sentence on what the session went through: "2 lessons, a check and a question in this session." */
export function tallyLine(tally: SessionTally): string {
  const parts = TALLY_ORDER.filter(({ kind }) => (tally[kind] ?? 0) > 0).map(({ kind, one, many }) => {
    const n = tally[kind]!;
    return n === 1 ? one : `${n} ${many}`;
  });
  if (parts.length === 0) return 'Nothing gone through in this session.';
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} in this session.`;
}

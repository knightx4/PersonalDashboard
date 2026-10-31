import { describe, expect, it } from 'vitest';
import type { DueReview } from '@/lib/learn/lessons/review';
import type { CellEvidence, LevelCell, LevelTopic, TopicMap, Verdict } from '@/lib/learn/levels/model';
import { RECHECK_EVERY } from '@/lib/learn/levels/pick';
import {
  checkKey,
  chooseLesson,
  chooseNext,
  lessonKey,
  levelLessonKey,
  orderSubjects,
  questionKey,
  reviewKey,
  taskKey,
  type ChooseNextInput,
  type SessionLesson,
  type SessionPiece,
  type SessionSubject,
} from './choose';

const NOW = new Date('2026-10-26T12:00:00Z');
const OLD = '2026-10-20T10:00:00Z';
const JUST_NOW = '2026-10-26T11:55:00Z';

const DCF: LevelTopic = { id: 'dcf', name: 'Discounted cash flow', ceiling: 4, approved: true };
/** A topic from the business pack: approved, and no subject of yours teaches it. */
const MOATS: LevelTopic = { id: 'moats', name: 'Competitive moats', ceiling: 3, approved: true };
const DRAFT: LevelTopic = { id: 'draft', name: 'Unapproved draft', ceiling: 3, approved: false };

function cellsFor(topics: readonly LevelTopic[]): LevelCell[] {
  return topics.flatMap((t) =>
    Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
  );
}

function ev(cellId: string, verdict: Verdict, observedAt = OLD): CellEvidence {
  return { cellId, verdict, observedAt };
}

function topicMap(topics: LevelTopic[], evidence: CellEvidence[] = []): TopicMap {
  return { topics, cells: cellsFor(topics), links: [], evidence };
}

/** Every askable level of these topics shown. */
function allShown(topics: LevelTopic[]): CellEvidence[] {
  return cellsFor(topics).map((c) => ev(c.id, 'met'));
}

function review(conceptId: string, dueOn = '2026-10-25'): DueReview {
  return {
    conceptId,
    name: `Idea ${conceptId}`,
    subjectId: 'fin',
    trackName: 'Finance',
    pieceId: null,
    pieceTitle: null,
    dueOn,
    open: null,
  };
}

function lesson(conceptId: string, read = false): SessionLesson {
  return { conceptId, name: `Idea ${conceptId}`, cardId: `card-${conceptId}`, read };
}

function piece(id: string, over: Partial<SessionPiece> = {}): SessionPiece {
  return {
    id,
    title: `Piece ${id}`,
    passed: false,
    held: false,
    lessons: [lesson(`${id}-a`), lesson(`${id}-b`)],
    openCheckId: null,
    checkAsked: false,
    checkPassed: false,
    taskId: `task-${id}`,
    taskPassed: false,
    ...over,
  };
}

function subject(id: string, over: Partial<SessionSubject> = {}): SessionSubject {
  return { id, name: `Subject ${id}`, aimId: null, lastWorked: null, pieces: [piece(`${id}1`), piece(`${id}2`)], ...over };
}

function input(over: Partial<ChooseNextInput> = {}): ChooseNextInput {
  return { reviews: [], subjects: [], map: topicMap([]), answered: 0, now: NOW, ...over };
}

describe('chooseNext: reviews come first', () => {
  it('returns a due review before anything else', () => {
    const item = chooseNext(
      input({ reviews: [review('r1'), review('r2')], subjects: [subject('fin', { lastWorked: OLD })], map: topicMap([DCF]) }),
    );
    expect(item).toMatchObject({ kind: 'review', key: reviewKey('r1') });
  });

  it('moves on to the next review once one is skipped', () => {
    const item = chooseNext(input({ reviews: [review('r1'), review('r2')], skip: new Set([reviewKey('r1')]) }));
    expect(item).toMatchObject({ kind: 'review', key: reviewKey('r2') });
  });
});

describe('chooseNext: the piece you are on', () => {
  const started = (pieces: SessionPiece[]) => subject('fin', { lastWorked: OLD, pieces });

  it('gives the next unread lesson in the piece', () => {
    const item = chooseNext(input({ subjects: [started([piece('p1', { lessons: [lesson('a', true), lesson('b')] })])] }));
    expect(item).toMatchObject({ kind: 'lesson', pieceId: 'p1', conceptId: 'b', cardId: 'card-b', starting: false });
  });

  it('gives a lesson not written yet with no card, for the player to write', () => {
    const item = chooseNext(
      input({ subjects: [started([piece('p1', { lessons: [{ conceptId: 'a', name: 'A', cardId: null, read: false }] })])] }),
    );
    expect(item).toMatchObject({ kind: 'lesson', conceptId: 'a', cardId: null });
  });

  it("gives the piece's check once its lessons are read", () => {
    const item = chooseNext(
      input({ subjects: [started([piece('p1', { lessons: [lesson('a', true)], openCheckId: 'chk' })])] }),
    );
    expect(item).toMatchObject({ kind: 'check', key: checkKey('p1'), checkId: 'chk' });
  });

  it('treats the lessons as read once a check has been asked', () => {
    const item = chooseNext(input({ subjects: [started([piece('p1', { checkAsked: true })])] }));
    expect(item).toMatchObject({ kind: 'check', pieceId: 'p1' });
  });

  it('treats the lessons of a piece a placement held as read', () => {
    const item = chooseNext(input({ subjects: [started([piece('p1', { held: true })])] }));
    expect(item).toMatchObject({ kind: 'check', pieceId: 'p1' });
  });

  it('gives the practice task once the check is passed', () => {
    const item = chooseNext(input({ subjects: [started([piece('p1', { checkAsked: true, checkPassed: true })])] }));
    expect(item).toMatchObject({ kind: 'task', key: taskKey('p1'), taskId: 'task-p1' });
  });

  it('goes on to the next piece once one is passed', () => {
    const item = chooseNext(input({ subjects: [started([piece('p1', { passed: true }), piece('p2')])] }));
    expect(item).toMatchObject({ kind: 'lesson', pieceId: 'p2', conceptId: 'p2-a' });
  });

  it('skips past what was passed over in the session', () => {
    const subjects = [started([piece('p1', { lessons: [lesson('a', true)] }), piece('p2')])];
    const item = chooseNext(input({ subjects, skip: new Set([checkKey('p1'), taskKey('p1')]) }));
    expect(item).toMatchObject({ kind: 'lesson', pieceId: 'p2' });
    expect(chooseNext(input({ subjects, skip: new Set([lessonKey('p2', 'p2-a')]) }))).toMatchObject({ kind: 'check', pieceId: 'p1' });
  });

  it("comes before a practice question, and a goal's subject before the one worked on last", () => {
    const recent = subject('recent', { lastWorked: '2026-10-25T09:00:00Z' });
    const goal = subject('goal', { aimId: 'aim-1', lastWorked: '2026-10-01T09:00:00Z' });
    const item = chooseNext(input({ subjects: [recent, goal], map: topicMap([DCF]) }));
    expect(item).toMatchObject({ kind: 'lesson', subjectId: 'goal', aimId: 'aim-1' });
  });

  it('takes the subject worked on most recently when no goal points at either', () => {
    const older = subject('older', { lastWorked: '2026-10-01T09:00:00Z' });
    const recent = subject('recent', { lastWorked: '2026-10-25T09:00:00Z' });
    expect(orderSubjects([older, recent]).map((s) => s.id)).toEqual(['recent', 'older']);
    expect(chooseNext(input({ subjects: [older, recent] }))).toMatchObject({ subjectId: 'recent' });
  });
});

describe('chooseNext: practice questions', () => {
  it('asks a question when no subject is under way, even with a ready one waiting', () => {
    const item = chooseNext(input({ subjects: [subject('fin')], map: topicMap([DCF], [ev('dcf1', 'not_met')]) }));
    expect(item?.kind).toBe('question');
  });

  it('teaches a business-pack topic level before its first question', () => {
    const item = chooseNext(input({ map: topicMap([DCF, MOATS], allShown([DCF])) }));
    expect(item).toMatchObject({ kind: 'level_lesson', lessonId: null, cell: { topicId: 'moats' } });
    const cellId = item?.kind === 'level_lesson' ? item.cell.cellId : '';
    expect(item?.key).toBe(levelLessonKey(cellId));
  });

  /** The level a fresh MOATS asks first, which its lesson comes before. */
  const first = (() => {
    const item = chooseNext(input({ map: topicMap([MOATS]) }));
    return item?.kind === 'level_lesson' ? item.cell.cellId : 'none';
  })();

  it('carries the stored lesson, and asks the question once it has been shown', () => {
    const map = topicMap([MOATS]);
    const unread = new Map([[first, { id: 'll-1', status: 'ready' as const, read: false }]]);
    expect(chooseNext(input({ map, levelLessons: unread }))).toMatchObject({ kind: 'level_lesson', lessonId: 'll-1' });
    const read = new Map([[first, { id: 'll-1', status: 'ready' as const, read: true }]]);
    expect(chooseNext(input({ map, levelLessons: read }))).toMatchObject({ kind: 'question', key: questionKey(first) });
  });

  it('asks the question straight away after the lesson is passed over, declined, or taught by a piece', () => {
    const map = topicMap([MOATS]);
    expect(chooseNext(input({ map, skip: new Set([levelLessonKey(first)]) }))).toMatchObject({ kind: 'question', key: questionKey(first) });
    const dropped = new Map([[first, { id: 'll-1', status: 'dropped' as const, read: false }]]);
    expect(chooseNext(input({ map, levelLessons: dropped }))).toMatchObject({ kind: 'question', key: questionKey(first) });
    expect(chooseNext(input({ map, taughtCells: new Set([first]) }))).toMatchObject({ kind: 'question', key: questionKey(first) });
  });

  it('teaches no level that has been asked before', () => {
    const map = topicMap([MOATS], [ev('moats1', 'met'), ev('moats2', 'not_met')]);
    expect(chooseNext(input({ map }))).toMatchObject({ kind: 'question', key: questionKey('moats2') });
  });

  it('asks a missed level before anything new, with the line saying why', () => {
    const map = topicMap([DCF], [ev('dcf1', 'met'), ev('dcf2', 'met'), ev('dcf3', 'not_met')]);
    const item = chooseNext(input({ map }));
    expect(item).toMatchObject({ kind: 'question', key: questionKey('dcf3'), cell: { reason: 'fringe', missed: true } });
    expect(item && item.kind === 'question' ? item.why : '').toContain('comes back before anything new');
  });

  it('asks a re-check one answer in five when one is due', () => {
    const map = topicMap([MOATS], [ev('moats3', 'met', '2026-08-01T00:00:00Z')]);
    const item = chooseNext(input({ map, answered: RECHECK_EVERY - 1 }));
    expect(item).toMatchObject({ kind: 'question', cell: { reason: 'recheck', cellId: 'moats3' } });
  });

  it('still asks a resting level rather than return nothing', () => {
    const map = topicMap([MOATS], [ev('moats1', 'met'), ev('moats2', 'met'), ev('moats3', 'not_met', JUST_NOW)]);
    const item = chooseNext(input({ map }));
    expect(item).toMatchObject({ kind: 'question', cell: { cellId: 'moats3' } });
  });

  it('never asks about a draft topic', () => {
    expect(chooseNext(input({ map: topicMap([DRAFT]) }))).toBeNull();
  });
});

describe('chooseNext: starting the next ready subject', () => {
  it('gives the first piece of a subject not started once every level is held', () => {
    const item = chooseNext(
      input({ subjects: [subject('fin'), subject('law', { aimId: 'aim-2' })], map: topicMap([DCF], allShown([DCF])) }),
    );
    expect(item).toMatchObject({ kind: 'lesson', subjectId: 'law', pieceId: 'law1', starting: true });
  });

  it('passes over a subject whose pieces are all passed', () => {
    const done = subject('done', { aimId: 'aim-1', pieces: [piece('d1', { passed: true })] });
    const item = chooseNext(input({ subjects: [done, subject('next')] }));
    expect(item).toMatchObject({ subjectId: 'next', starting: true });
  });
});

describe('chooseNext: nothing left', () => {
  it('returns null for an account with nothing in it', () => {
    expect(chooseNext(input())).toBeNull();
  });

  it('returns null when every piece is passed and every askable level held', () => {
    const subjects = [subject('fin', { lastWorked: OLD, pieces: [piece('p1', { passed: true })] })];
    // Level 10 is a defence the flow cannot ask yet, so a ten-level topic held to 9 is finished here.
    const deep: LevelTopic = { id: 'deep', name: 'Deep', ceiling: 10, approved: true };
    const evidence = cellsFor([deep]).filter((c) => c.level < 10).map((c) => ev(c.id, 'met'));
    expect(chooseNext(input({ subjects, map: topicMap([deep], evidence) }))).toBeNull();
  });

  it('never returns nothing while an approved topic has a level not held', () => {
    const topics = [DCF, MOATS];
    const cells = cellsFor(topics);
    // Every combination of shown, missed (long ago or just now) and unanswered
    // on DCF's four levels, with MOATS held throughout or not at all.
    const states = ['open', 'met', 'not_met', 'missed_now'] as const;
    let checked = 0;
    for (let mask = 0; mask < states.length ** 4; mask += 1) {
      for (const moatsHeld of [true, false]) {
        const evidence: CellEvidence[] = moatsHeld ? allShown([MOATS]) : [];
        for (let level = 1; level <= 4; level += 1) {
          const state = states[Math.floor(mask / states.length ** (level - 1)) % states.length];
          if (state === 'met') evidence.push(ev(`dcf${level}`, 'met'));
          if (state === 'not_met') evidence.push(ev(`dcf${level}`, 'not_met'));
          if (state === 'missed_now') evidence.push(ev(`dcf${level}`, 'not_met', JUST_NOW));
        }
        const map = topicMap(topics, evidence);
        const shownIds = new Set(evidence.filter((e) => e.verdict === 'met').map((e) => e.cellId));
        // Held is shown or implied by a shown cell above it on the same topic.
        const unheld = cells.some(
          (c) => !cells.some((above) => above.topicId === c.topicId && above.level >= c.level && shownIds.has(above.id)),
        );
        for (const answered of [0, RECHECK_EVERY - 1]) {
          const item = chooseNext(input({ map, answered }));
          if (unheld) expect(item, `mask ${mask}, moats held ${moatsHeld}`).not.toBeNull();
          checked += 1;
        }
      }
    }
    expect(checked).toBe(states.length ** 4 * 4);
  });
});

describe('chooseLesson: Quick learn gives lessons only', () => {
  const started = (pieces: SessionPiece[]) => subject('fin', { lastWorked: OLD, pieces });

  it('gives the next unread lesson, passing over a due review', () => {
    const item = chooseLesson(input({ reviews: [review('r1')], subjects: [started([piece('p1')])] }));
    expect(item).toMatchObject({ kind: 'lesson', pieceId: 'p1', conceptId: 'p1-a' });
  });

  it("passes over a piece's open check and task to the next piece's lessons", () => {
    const item = chooseLesson(input({ subjects: [started([piece('p1', { checkAsked: true }), piece('p2')])] }));
    expect(item).toMatchObject({ kind: 'lesson', pieceId: 'p2', conceptId: 'p2-a' });
  });

  it("teaches a topic level's lesson and never its question", () => {
    const map = topicMap([MOATS]);
    const item = chooseLesson(input({ map }));
    expect(item).toMatchObject({ kind: 'level_lesson', cell: { topicId: 'moats', level: 1 } });
    const cellId = item?.kind === 'level_lesson' ? item.cell.cellId : '';
    const read = new Map([[cellId, { id: 'll-1', status: 'ready' as const, read: true }]]);
    expect(chooseLesson(input({ map, levelLessons: read }))).toMatchObject({ kind: 'level_lesson', cell: { level: 2 } });
  });

  it('gives a subject you are on before a topic level, and a new subject after one', () => {
    const map = topicMap([MOATS]);
    expect(chooseLesson(input({ map, subjects: [started([piece('p1')])] }))).toMatchObject({ kind: 'lesson' });
    expect(chooseLesson(input({ map, subjects: [subject('new')] }))).toMatchObject({ kind: 'level_lesson' });
    expect(chooseLesson(input({ map: topicMap([MOATS], allShown([MOATS])), subjects: [subject('new')] }))).toMatchObject({
      kind: 'lesson',
      subjectId: 'new',
      starting: true,
    });
  });

  it('is null once every lesson is read, with questions still to ask', () => {
    const subjects = [started([piece('p1', { lessons: [lesson('a', true)] })])];
    const map = topicMap([DCF], cellsFor([DCF]).map((c) => ev(c.id, 'not_met')));
    expect(chooseNext(input({ subjects, map }))?.kind).toBe('check');
    expect(chooseLesson(input({ subjects, map }))).toBeNull();
  });
});

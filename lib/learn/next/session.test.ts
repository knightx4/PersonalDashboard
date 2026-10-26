import { describe, expect, it } from 'vitest';
import type { NextItem } from './choose';
import { addToTally, placeLine, startLine, tallyKind, tallyLine, tallyTotal, type SessionItem } from './session';

const place = {
  subjectId: 's1',
  subjectName: 'Corporate strategy',
  aimId: null,
  pieceId: 'p1',
  pieceTitle: 'Where an industry’s profits go',
  starting: false,
};

describe('placeLine', () => {
  it('names the subject and piece of a lesson, check or task', () => {
    const lesson: NextItem = { ...place, kind: 'lesson', key: 'k', conceptId: 'c1', conceptName: 'Supplier power', cardId: null };
    expect(placeLine(lesson)).toBe('Corporate strategy · Where an industry’s profits go');
    expect(placeLine({ ...place, kind: 'check', key: 'k', checkId: null })).toBe(placeLine(lesson));
    expect(placeLine({ ...place, kind: 'task', key: 'k', taskId: null })).toBe(placeLine(lesson));
  });

  it('names the topic and level of a question', () => {
    const item: NextItem = {
      kind: 'question',
      key: 'question:c',
      why: '',
      cell: {
        cellId: 'c',
        topicId: 't',
        topicName: 'Competitive advantage',
        level: 4,
        reason: 'fringe',
        heldTo: 3,
        missed: false,
        direction: null,
        unlocks: 0,
        heldSince: null,
      },
    };
    expect(placeLine(item)).toBe('Competitive advantage · level 4');
    expect(placeLine({ kind: 'level_lesson', key: 'level_lesson:c', cell: item.cell, lessonId: null, why: '' })).toBe(
      'Competitive advantage',
    );
  });

  it('names the subject and the piece that taught a review, leaving out a piece it has none of', () => {
    const review = {
      conceptId: 'c',
      name: 'Switching costs',
      subjectId: 's1',
      trackName: 'Corporate strategy',
      pieceId: null,
      pieceTitle: null,
      dueOn: '2026-10-24',
      open: null,
    };
    expect(placeLine({ kind: 'review', key: 'review:c', review })).toBe('Corporate strategy');
    expect(placeLine({ kind: 'review', key: 'review:c', review: { ...review, pieceId: 'p', pieceTitle: 'Lock-in' } })).toBe(
      'Corporate strategy · Lock-in',
    );
  });
});

describe('the tally', () => {
  it('counts what was gone through and leaves a failed item out', () => {
    const failed: SessionItem = { kind: 'failed', key: 'k', line: '', was: 'task', error: 'x' };
    let tally = addToTally({}, 'lesson');
    tally = addToTally(tally, 'lesson');
    tally = addToTally(tally, tallyKind(failed));
    tally = addToTally(tally, 'question');
    const levelLesson = { kind: 'level_lesson', key: 'l', line: '', lesson: {} } as unknown as SessionItem;
    tally = addToTally(tally, tallyKind(levelLesson));
    expect(tally).toEqual({ lesson: 3, question: 1 });
    expect(tallyTotal(tally)).toBe(4);
  });

  it('says it in one sentence, lessons first', () => {
    expect(tallyLine({})).toBe('Nothing gone through in this session.');
    expect(tallyLine({ check: 1 })).toBe('A check in this session.');
    expect(tallyLine({ review: 1, lesson: 2, question: 3 })).toBe('2 lessons, 3 questions and a review in this session.');
  });
});

describe('startLine', () => {
  it('titles a lesson by its idea and places it by subject and piece', () => {
    const lesson: NextItem = { ...place, kind: 'lesson', key: 'k', conceptId: 'c1', conceptName: 'Supplier power', cardId: null };
    expect(startLine(lesson)).toEqual({
      kind: 'lesson',
      word: 'Lesson',
      title: 'Supplier power',
      place: 'Corporate strategy · Where an industry’s profits go',
    });
  });

  it('titles a check by its piece and a question by its topic and level', () => {
    expect(startLine({ ...place, kind: 'check', key: 'k', checkId: null })).toMatchObject({
      word: 'Check',
      title: 'Where an industry’s profits go',
      place: 'Corporate strategy',
    });
    const cell = {
      cellId: 'c', topicId: 't', topicName: 'Competitive advantage', level: 4, reason: 'fringe' as const,
      heldTo: 3, missed: false, direction: null, unlocks: 0, heldSince: null,
    };
    expect(startLine({ kind: 'question', key: 'q', why: '', cell })).toMatchObject({
      word: 'Question',
      title: 'Competitive advantage',
      place: 'Level 4',
    });
  });
});

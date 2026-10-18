import { describe, expect, it } from 'vitest';
import {
  checkedTurn,
  checkTurn,
  explainTurn,
  isQuestionToDash,
  parsePieceTalk,
  talkLabel,
  talkMeta,
  talkSections,
  talkView,
} from './piece-talk';
import type { PieceIdea } from './piece-store';

const A = '5c000000-0000-4000-8000-000000000101';
const B = '5c000000-0000-4000-8000-000000000102';
const P = '5d000000-0000-4000-8000-000000000501';

const idea = (conceptId: string, lesson: PieceIdea['lesson'] = null): PieceIdea => ({
  conceptId,
  name: 'Gross revenue retention',
  claim: 'Gross retention counts only what was lost.',
  lesson,
  dropped: null,
});

describe('parsePieceTalk', () => {
  it('reads each stage and refuses anything else', () => {
    expect(parsePieceTalk({ stage: 'explain', conceptId: A, probeId: P })).toEqual({ stage: 'explain', conceptId: A, probeId: P });
    expect(parsePieceTalk({ stage: 'check', checkId: null })).toEqual({ stage: 'check', checkId: null });
    expect(parsePieceTalk({ stage: 'done' })).toEqual({ stage: 'done' });
    expect(parsePieceTalk(null)).toBeNull();
    expect(parsePieceTalk({ stage: 'explain', conceptId: 'x' })).toBeNull();
  });
});

describe('talkView and its words', () => {
  const ideas = [idea(A), idea(B)];

  it('starts on the first idea', () => {
    expect(talkView(null, ideas)).toEqual({ stage: 'explain', idea: 0 });
    expect(talkMeta(talkView(null, ideas), 2)).toBe('Idea 1 of 2, then one question');
  });

  it('follows the idea being asked about', () => {
    const view = talkView({ stage: 'follow_up', conceptId: B, probeId: P, followUpId: P }, ideas);
    expect(view).toEqual({ stage: 'follow_up', idea: 1 });
    expect(talkLabel(view)).toBe('Answer the follow-up');
  });

  it('names the check and the finish', () => {
    expect(talkMeta(talkView({ stage: 'check', checkId: P }, ideas), 2)).toMatch(/^The check/);
    expect(talkMeta(talkView({ stage: 'done' }, ideas), 2)).toBe('Finished');
  });
});

describe('explainTurn', () => {
  it('explains from the lesson, then asks', () => {
    const body = explainTurn(
      idea(A, {
        takeaway: 'It leaves upgrades out.',
        context: null,
        hook: null,
        summary: 'Subtract what was lost.',
        example: '89 of 100 kept.',
        figures: [],
        question: null,
        answer: null,
      }),
      0,
      3,
    );
    expect(body.split('\n')[0]).toBe('Idea 1 of 3: Gross revenue retention');
    expect(body).toContain('It leaves upgrades out.');
    expect(body).toContain('For example: 89 of 100 kept.');
    expect(body.trim().endsWith('give an example of your own.')).toBe(true);
  });

  it('falls back to the idea as kept when no lesson is written', () => {
    expect(explainTurn(idea(A), 1, 2)).toContain('Gross retention counts only what was lost.');
  });
});

describe('isQuestionToDash', () => {
  it('reads a turn ending in a question mark as a question', () => {
    expect(isQuestionToDash('What counts as a downgrade? ')).toBe(true);
    expect(isQuestionToDash('It is what they pay now over what they paid then.')).toBe(false);
  });
});

describe('the check', () => {
  it('asks it as the last turn', () => {
    expect(checkTurn(' Why both numbers? ')).toMatch(/Last, one question[\s\S]*\*\*Why both numbers\?\*\*$/);
  });

  it('finishes on a right answer and asks again on a wrong one', () => {
    expect(checkedTurn({ correct: true, why: 'Right.', expected: null }, null)).toContain('That finishes today’s piece.');
    const wrong = checkedTurn({ correct: false, why: 'Missed upgrades.', expected: 'Upgrades add 20 points.' }, 'Another?');
    expect(wrong).toContain('What I was looking for: Upgrades add 20 points.');
    expect(wrong).toContain('Try this one instead:\n\n**Another?**');
  });
});

describe('talkSections', () => {
  const at = (n: number) => `2026-10-15T08:0${n}:00.000Z`;
  const lesson = (n: number, name: string) => `Idea ${n} of 2: ${name}\n\nThe lesson.\n\nExplain this idea…`;

  it('cuts the thread where an idea or the check starts, keeping where each idea ended', () => {
    const sections = talkSections([
      { id: '1', role: 'assistant', body: lesson(1, 'Net retention'), createdAt: at(1) },
      { id: '2', role: 'user', body: 'An answer.', createdAt: at(2) },
      { id: '3', role: 'assistant', body: 'What you got right:\n- a\n\nNet retention is now marked sharp.', createdAt: at(3) },
      { id: '4', role: 'assistant', body: lesson(2, 'Gross retention'), createdAt: at(4) },
      { id: '5', role: 'assistant', body: checkTurn('Why both?'), createdAt: at(5) },
    ]);
    expect(sections.map((section) => section.kind)).toEqual(['idea', 'idea', 'check']);
    expect(sections[0]).toMatchObject({ number: 1, total: 2, name: 'Net retention', state: 'sharp' });
    expect(sections[0]!.turns.map((turn) => turn.id)).toEqual(['1', '2', '3']);
    expect(sections[1]).toMatchObject({ name: 'Gross retention', state: null });
  });

  it('reads an empty thread as no sections', () => {
    expect(talkSections([])).toEqual([]);
  });
});

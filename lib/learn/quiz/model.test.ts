import { describe, expect, it } from 'vitest';
import { quizTitle } from '@/lib/learn/quiz/model';

describe('quizTitle', () => {
  it('uses what you are preparing for when you said', () => {
    expect(
      quizTitle({ preparingFor: 'Interview on Thursday', noteNames: ['Rates'], today: '2026-09-14' }),
    ).toBe('Interview on Thursday');
  });

  it('takes the first line of a multi-line answer', () => {
    expect(
      quizTitle({ preparingFor: '  \nSystems design round\nand the rest', noteNames: [], today: '2026-09-14' }),
    ).toBe('Systems design round');
  });

  it('falls back to the one note it is over', () => {
    expect(quizTitle({ preparingFor: '', noteNames: ['Bond maths'], today: '2026-09-14' })).toBe(
      'Bond maths',
    );
  });

  it('names both notes when there are two', () => {
    expect(
      quizTitle({ preparingFor: null, noteNames: ['Bond maths', 'Duration'], today: '2026-09-14' }),
    ).toBe('Bond maths and Duration');
  });

  it('counts the rest when there are more than two', () => {
    expect(
      quizTitle({ preparingFor: null, noteNames: ['A', 'B', 'C', 'D'], today: '2026-09-14' }),
    ).toBe('A and 3 more');
  });

  it('falls back to the date when there is nothing but a paste', () => {
    expect(quizTitle({ preparingFor: null, noteNames: [], today: '2026-09-14' })).toBe(
      'Quiz, 2026-09-14',
    );
  });

  it('trims a long line rather than storing a paragraph as a name', () => {
    const title = quizTitle({ preparingFor: 'x'.repeat(200), noteNames: [], today: '2026-09-14' });
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });
});

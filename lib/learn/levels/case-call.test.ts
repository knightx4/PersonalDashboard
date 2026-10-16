import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { casePrompt } from '@/lib/learn/levels/case-call';
import { gradePrompt } from '@/lib/learn/levels/grade-call';
import { questionFormat } from '@/lib/learn/levels/model';

describe('casePrompt', () => {
  it('names the level, its checks and the cases already asked', () => {
    const text = casePrompt({
      topicName: 'DCF',
      level: 4,
      descriptor: ['Can build one from given projections'],
      asked: ['A firm earns $10m.'],
    });
    expect(text).toContain('Level: 4');
    expect(text).toContain('- Can build one from given projections');
    expect(text).toContain('A firm earns $10m.');
  });
});

describe('gradePrompt for a case', () => {
  const cells = [
    { key: 'C1', cellId: 'a', topicId: 't', topicName: 'DCF', level: 4, descriptor: ['x'], role: 'asked' as const },
  ];
  it('gives the grader the expected answer and limits it to C1', () => {
    const text = gradePrompt({ cells, question: 'Value it.', answer: '$34', expected: 'About $34 a share.' });
    expect(text).toContain('only C1 is graded');
    expect(text).toContain('About $34 a share.');
  });
  it('leaves the case wording out of an explanation', () => {
    expect(gradePrompt({ cells, question: 'Explain.', answer: 'a' })).not.toContain('only C1');
  });
});

describe('which levels are cases', () => {
  it('asks levels 4 to 6 as cases', () => {
    expect([3, 4, 5, 6, 7].map(questionFormat)).toEqual(['explain', 'case', 'case', 'case', 'explain']);
  });
});

describe('casePrompt for an idea on the claims graph', () => {
  it('names the idea when it is given', () => {
    const text = casePrompt({
      topicName: 'Burn multiple',
      level: 4,
      descriptor: ['Works it out from net burn and new ARR'],
      asked: [],
      claim: 'Burn multiple is net burn over net new ARR.',
    });
    expect(text).toContain('The idea: Burn multiple is net burn over net new ARR.');
  });
});

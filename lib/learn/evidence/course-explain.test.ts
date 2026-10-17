import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_LEVELS,
  PROMPT_TOPICS,
  courseExplainCells,
  courseExplainPrompt,
  courseMarks,
  markResults,
  marksLine,
} from './course-explain';

const course = { code: 'MGT 847', title: 'Private Equity', grade: 'H', year: 2025 };
const topics = [
  { id: 'debt', title: 'Debt' },
  { id: 'equity', title: 'Equity' },
  { id: 'finance', title: 'Finance' },
];

describe('the explain prompt on a course', () => {
  it('names the topics the course was named for', () => {
    expect(courseExplainPrompt(topics)).toBe(
      'Explain what this course taught you to a friend who never took it. Take the ideas you remember from Debt, Equity and Finance, and for each say what it means, how it works and why each part is there.',
    );
  });

  it('grades levels 1 to 3 of every topic, at most eight topics', () => {
    const cells = courseExplainCells(topics);
    expect(cells).toHaveLength(topics.length * EXPLAIN_LEVELS.length);
    expect(cells.map((c) => c.key).slice(0, 3)).toEqual(['C1', 'C2', 'C3']);
    expect(cells.every((c) => c.role === 'course' && c.descriptor.length > 0)).toBe(true);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `Topic ${i}` }));
    expect(courseExplainCells(many)).toHaveLength(PROMPT_TOPICS * EXPLAIN_LEVELS.length);
  });
});

describe('the marks an answer makes', () => {
  const cells = courseExplainCells(topics);
  const key = (topicId: string, level: number) => cells.find((c) => c.topicId === topicId && c.level === level)!.key;
  const answer = 'Debt is money borrowed that must be paid back with interest. The interest is the price of time.';

  it('tests a topic at the highest level met, misses one tried and failed, and leaves one untouched', () => {
    const marks = courseMarks({
      course,
      cells,
      answer,
      verdicts: [
        { cell: key('debt', 1), verdict: 'met', quote: 'Debt is money borrowed' },
        { cell: key('debt', 2), verdict: 'met', quote: 'Debt is money borrowed that must be paid back with interest.' },
        { cell: key('debt', 3), verdict: 'not_met' },
        { cell: key('equity', 2), verdict: 'not_met' },
        { cell: key('finance', 1), verdict: 'not_touched' },
      ],
    });
    expect(marks).toEqual([
      {
        topic_id: 'debt',
        level: 2,
        quote: 'Debt is money borrowed that must be paid back with interest.',
        basis: 'from MGT 847 Private Equity, H, 2025, and your explanation of it: tested at level 2.',
      },
      {
        topic_id: 'equity',
        level: 0,
        quote: null,
        basis: 'from MGT 847 Private Equity, H, 2025: your explanation did not show it.',
      },
    ]);
  });

  it('throws out a met whose words are not in the answer', () => {
    const marks = courseMarks({
      course,
      cells,
      answer,
      verdicts: [{ cell: key('debt', 3), verdict: 'met', quote: 'Debt amplifies returns on equity.' }],
    });
    expect(marks).toEqual([]);
  });

  it('reads as one line on the course row', () => {
    const results = markResults(
      [
        { topic_id: 'equity', level: 0, quote: null, basis: '' },
        { topic_id: 'debt', level: 2, quote: 'x', basis: '' },
        { topic_id: 'finance', level: 3, quote: 'y', basis: '' },
      ],
      topics,
    );
    expect(marksLine(results)).toBe('Tested: Finance at level 3 and Debt at level 2. Not shown: Equity.');
    expect(marksLine([])).toMatch(/keeps its likely levels/);
  });
});

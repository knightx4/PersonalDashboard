import { describe, expect, it } from 'vitest';
import { readFoundPoints, readReadback, readReview, readShapes, usableQuestion } from './guide';
import { EMPTY_PLAN, withPoint } from './plan';

describe("Dash's read of the brief", () => {
  it('keeps notes that end in a question and sharper questions, and drops praise', () => {
    const read = readReadback(
      [
        'NOTE: Your question asks “how to think about” it. What is the answer a reader could disagree with?',
        'NOTE: Great start! What next?',
        'NOTE: You list two frameworks.',
        'SHARPER: Does the SOX control mindset fit AI in finance better than an AI-specific framework?',
        'SHARPER: Not a question',
      ].join('\n'),
    );
    expect(read.notes).toEqual([
      'Your question asks “how to think about” it. What is the answer a reader could disagree with?',
    ]);
    expect(read.sharper).toEqual([
      'Does the SOX control mindset fit AI in finance better than an AI-specific framework?',
    ]);
  });
});

describe('points found in their writing', () => {
  it('keeps only passages that are word for word theirs and not already points', () => {
    const sources = [
      { text: 'Prefer preventative controls wherever possible. Detective fills in the holes.' },
    ];
    const plan = withPoint(EMPTY_PLAN, 'Detective fills in the holes.');
    expect(
      readFoundPoints(
        'QUOTE: Prefer preventative controls wherever possible\nQUOTE: Detective fills in the holes.\nQUOTE: Prefer preventive controls always',
        sources,
        plan.points,
      ),
    ).toEqual(['Prefer preventative controls wherever possible']);
  });
});

describe('notes on the plan', () => {
  it('reads None as no notes', () => {
    expect(readReview('None')).toEqual([]);
    expect(readReview('NOTE: Point 3 is two points. Which one matters more?')).toHaveLength(1);
  });
});

describe('shapes', () => {
  it('reads parts, maps point numbers to ids and drops unknown roles', () => {
    const plan = withPoint(withPoint(EMPTY_PLAN, 'one'), 'two');
    const shapes = readShapes(
      [
        '## Claim then reasons',
        'WHY: Plain and direct.',
        'PART: introduction | Gives the answer up front. |',
        'PART: point | Each reason. | 1, 2, 9',
        'PART: aside | Something odd. | 1',
        '## Too short',
        'PART: point | Only one. | 1',
      ].join('\n'),
      plan,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.parts).toEqual([
      { role: 'opening', guide: 'Gives the answer up front.', points: [] },
      { role: 'point', guide: 'Each reason.', points: ['p1', 'p2'] },
    ]);
  });
});

describe('questions', () => {
  it('takes one question and refuses two', () => {
    expect(usableQuestion('Why is it true?')).toBe('Why is it true?');
    expect(usableQuestion('Why? And how?')).toBeNull();
  });
});

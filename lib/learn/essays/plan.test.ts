import { describe, expect, it } from 'vitest';
import {
  answeredPoint,
  EMPTY_PLAN,
  headingAbove,
  isOwnWords,
  movedPoint,
  nextDigKind,
  openingStage,
  outlineDraft,
  pointAtHeading,
  readPlan,
  shapedPlan,
  stageDone,
  withAsking,
  withPoint,
  withReview,
  withTake,
  closedReview,
} from './plan';

const brief = { question: 'Q?', claim: 'A.', reader: '', origin: '', change: '', pinned: [] };

describe('reading the plan', () => {
  it('reads anything missing or of the wrong type as empty', () => {
    expect(readPlan(null)).toEqual(EMPTY_PLAN);
    expect(readPlan({ thesis: 3, points: 'no', takes: [], review: {} })).toEqual(EMPTY_PLAN);
  });

  it('drops points without an id, and a second point with the same id', () => {
    const plan = readPlan({
      points: [{ text: 'no id' }, { id: 'p1', text: 'one' }, { id: 'p1', text: 'again' }],
    });
    expect(plan.points.map((p) => p.text)).toEqual(['one']);
    expect(plan.points[0]!.role).toBe('point');
  });
});

describe('points', () => {
  it('adds a point in the person’s words, once', () => {
    let plan = withPoint(EMPTY_PLAN, '  Rates set prices.  ');
    plan = withPoint(plan, 'rates  set prices.');
    expect(plan.points).toHaveLength(1);
    expect(plan.points[0]).toMatchObject({ id: 'p1', text: 'Rates set prices.' });
  });

  it('moves a point and stops at the ends', () => {
    let plan = withPoint(withPoint(EMPTY_PLAN, 'one'), 'two');
    plan = movedPoint(plan, 'p2', -1);
    expect(plan.points.map((p) => p.text)).toEqual(['two', 'one']);
    expect(movedPoint(plan, 'p2', -1)).toBe(plan);
  });

  it('keeps an answer under the point with the kind of question it answered', () => {
    let plan = withPoint(EMPTY_PLAN, 'one');
    plan = withAsking(plan, 'p1', 'example', 'Which example?');
    plan = answeredPoint(plan, 'p1', ' The agent. ');
    expect(plan.points[0]!.notes).toEqual([
      { ask: 'Which example?', answer: 'The agent.', kind: 'example' },
    ]);
    expect(plan.points[0]!.asking).toBeNull();
  });

  it('asks the kinds in the role’s order, skipping those asked', () => {
    const point = {
      role: 'point' as const,
      notes: [{ ask: 'a', answer: 'b', kind: 'why' as const }],
    };
    expect(nextDigKind(point)).toBe('example');
    expect(nextDigKind(point, 'doubt')).toBe('doubt');
  });
});

describe('shapes', () => {
  it('puts each point in its part, fills empty parts with slots, and keeps points the shape left out', () => {
    const plan = withPoint(withPoint(withPoint(EMPTY_PLAN, 'one'), 'two'), 'three');
    const shaped = shapedPlan(plan, {
      name: 'S',
      why: '',
      parts: [
        { role: 'opening', guide: 'Hook.', points: [] },
        { role: 'point', guide: 'Reasons.', points: ['p2', 'p1'] },
      ],
    });
    expect(shaped.shape).toBe('S');
    expect(shaped.points.map((p) => [p.text, p.role])).toEqual([
      ['', 'opening'],
      ['two', 'point'],
      ['one', 'point'],
      ['three', 'point'],
    ]);
    expect(shaped.points[0]!.guide).toBe('Hook.');
  });
});

describe('takes and review', () => {
  it('removes a take that is emptied', () => {
    const plan = withTake(withTake(EMPTY_PLAN, 'r:p0', 'mine'), 'r:p0', ' ');
    expect(plan.takes).toEqual({});
  });

  it('puts new notes first and keeps open ones', () => {
    let plan = withReview(EMPTY_PLAN, ['First?']);
    plan = closedReview(plan, 'r1');
    plan = withReview(plan, ['Second?']);
    expect(plan.review.map((n) => [n.body, n.status])).toEqual([['Second?', 'open']]);
  });
});

describe('stages', () => {
  it('opens on the interview, then the draft, then the first stage not done', () => {
    const done = stageDone({
      brief,
      interview: { status: 'done' },
      plan: EMPTY_PLAN,
      researched: false,
      words: 0,
    });
    expect(done.discover).toBe(true);
    expect(openingStage(done, true, 0)).toBe('discover');
    expect(openingStage(done, false, 400)).toBe('write');
    expect(openingStage(done, false, 0)).toBe('research');
  });
});

describe('from the plan to the draft', () => {
  const plan = withPoint(
    withPoint({ ...EMPTY_PLAN, points: [] }, 'Rates set prices'),
    'Cash buyers follow',
  );

  it('writes a heading per point in the person’s words, and nothing of Dash’s', () => {
    expect(outlineDraft(plan, 'My question')).toBe(
      '# My question\n\n## Rates set prices\n\n\n## Cash buyers follow\n\n',
    );
  });

  it('finds the point whose heading the caret is under', () => {
    const doc = outlineDraft(plan, 'T');
    const at = doc.indexOf('Cash') + 20;
    expect(headingAbove(doc, at)).toBe('Cash buyers follow');
    expect(pointAtHeading(plan, headingAbove(doc, at))?.id).toBe('p2');
    expect(headingAbove('# Title only\n\ntext', 14)).toBeNull();
  });
});

describe('own words', () => {
  it('accepts a passage found word for word, ignoring spacing and case', () => {
    const sources = [
      { text: 'Prefer preventative controls wherever  possible. Detective fills the holes.' },
    ];
    expect(isOwnWords('prefer preventative controls wherever possible', sources)).toBe(true);
    expect(isOwnWords('Prefer preventive controls wherever possible', sources)).toBe(false);
    expect(isOwnWords('Prefer', sources)).toBe(false);
  });
});

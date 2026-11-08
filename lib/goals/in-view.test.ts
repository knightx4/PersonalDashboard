import { describe, expect, it } from 'vitest';
import { goalRowsInView, type ChainItem } from './in-view';

const TODAY = '2026-11-08';

function item(id: string, parentId: string | null, over: Partial<ChainItem> = {}): ChainItem {
  return {
    id,
    parentId,
    level: parentId ? 'step' : 'goal',
    status: 'open',
    activity: null,
    archivedAt: null,
    startsOn: null,
    ...over,
  };
}

// The grad school goal of 8 November 2026: passive, with dated steps two levels down.
const tree: ChainItem[] = [
  item('grad', null, { activity: 'passive' }),
  item('materials', 'grad'),
  item('recommenders', 'materials'),
  item('transcripts', 'materials'),
  item('gaps', 'grad'),
  item('enrol', 'gaps'),
  item('job', null, { activity: 'active' }),
  item('apply', 'job'),
  item('cv', 'job'),
  item('city', null),
  item('meetup', 'city'),
];

describe('which goal rows a text may name (plan #3069)', () => {
  it('leaves out every step under a passive goal, at any depth, and the goal itself', () => {
    const ids = ['recommenders', 'transcripts', 'enrol', 'materials', 'grad', 'apply', 'meetup'];
    expect(goalRowsInView({ ids, items: tree, today: TODAY })).toEqual(['apply', 'meetup']);
  });

  it('keeps the steps of active goals as before, in the order given', () => {
    expect(goalRowsInView({ ids: ['cv', 'apply', 'job'], items: tree, today: TODAY })).toEqual(['cv', 'apply', 'job']);
  });

  it('keeps a passive step that counts towards an open active goal, by that goal', () => {
    const countsTowards = [{ itemId: 'recommenders', goalId: 'job' }];
    expect(goalRowsInView({ ids: ['recommenders', 'transcripts'], items: tree, countsTowards, today: TODAY })).toEqual([
      'recommenders',
    ]);
  });

  it('does not keep it by a goal that is passive, parked or archived itself', () => {
    const items = [
      ...tree,
      item('parked', null, { status: 'parked' }),
      item('gone', null, { archivedAt: '2026-10-01T00:00:00Z' }),
    ];
    const countsTowards = [
      { itemId: 'transcripts', goalId: 'grad' },
      { itemId: 'transcripts', goalId: 'parked' },
      { itemId: 'transcripts', goalId: 'gone' },
    ];
    expect(goalRowsInView({ ids: ['transcripts'], items, countsTowards, today: TODAY })).toEqual([]);
  });

  it('leaves out the steps of parked, done and archived goals, and of an archived step above', () => {
    const items = [
      item('parked', null, { status: 'parked' }),
      item('p1', 'parked'),
      item('done', null, { status: 'done' }),
      item('d1', 'done'),
      item('archived', null, { archivedAt: '2026-10-01T00:00:00Z' }),
      item('a1', 'archived'),
      item('live', null),
      item('old', 'live', { archivedAt: '2026-10-01T00:00:00Z' }),
      item('under-old', 'old'),
    ];
    expect(goalRowsInView({ ids: ['p1', 'd1', 'a1', 'under-old', 'done'], items, today: TODAY })).toEqual(['done']);
  });

  it('holds back a set-aside step until its day, and keeps it from then', () => {
    const items = [...tree, item('later', 'job', { startsOn: '2026-11-29' }), item('under-later', 'later')];
    expect(goalRowsInView({ ids: ['later', 'under-later'], items, today: TODAY })).toEqual([]);
    expect(goalRowsInView({ ids: ['later', 'under-later'], items, today: '2026-11-29' })).toEqual(['later', 'under-later']);
  });

  it('keeps a row the tree does not hold', () => {
    expect(goalRowsInView({ ids: ['unknown'], items: tree, today: TODAY })).toEqual(['unknown']);
  });
});

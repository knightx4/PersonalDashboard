import { describe, expect, it } from 'vitest';
import {
  checkProgressEntry,
  isProgressEstimate,
  lastProgressOn,
  latestBeneath,
  sortProgressEntries,
  summariseProgress,
  tallyProgress,
  tallyWords,
  talliesBesideTotal,
  towardsTotal,
  towardsTotalWords,
  type ProgressEntry,
} from './progress';

function entry(id: string, over: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    id,
    itemId: 'step-1',
    captureId: null,
    happenedOn: '2026-09-30',
    text: 'moved some bags',
    quantity: null,
    unit: null,
    estimate: null,
    createdAt: '2026-09-30T10:00:00Z',
    ...over,
  };
}

describe('checkProgressEntry', () => {
  it('trims the words and the unit and fills what was left out', () => {
    const result = checkProgressEntry({
      itemId: 'step-1',
      text: '  moved two bags to the office ',
      quantity: 2,
      unit: ' bags ',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        itemId: 'step-1',
        text: 'moved two bags to the office',
        happenedOn: null,
        quantity: 2,
        unit: 'bags',
        estimate: null,
        captureId: null,
      },
    });
  });

  it('takes a rough estimate when there is no amount', () => {
    const result = checkProgressEntry({ itemId: 's', text: 'about halfway', estimate: 'half' });
    expect(result.ok && result.value.estimate).toBe('half');
  });

  it('turns away what the table would refuse, with a reason', () => {
    expect(checkProgressEntry({ itemId: 's', text: '   ' })).toMatchObject({ ok: false });
    expect(checkProgressEntry({ itemId: 's', text: 'x'.repeat(2001) })).toMatchObject({ ok: false });
    expect(checkProgressEntry({ itemId: 's', text: 'x', quantity: 0 })).toMatchObject({ ok: false });
    expect(checkProgressEntry({ itemId: 's', text: 'x', quantity: -2 })).toMatchObject({ ok: false });
    expect(checkProgressEntry({ itemId: 's', text: 'x', quantity: Number.NaN })).toMatchObject({ ok: false });
    expect(checkProgressEntry({ itemId: 's', text: 'x', unit: 'bags' })).toMatchObject({ ok: false });
    expect(
      checkProgressEntry({ itemId: 's', text: 'x', quantity: 1, unit: 'u'.repeat(41) }),
    ).toMatchObject({ ok: false });
    expect(
      checkProgressEntry({ itemId: 's', text: 'x', estimate: 'most' as never }),
    ).toMatchObject({ ok: false });
    expect(checkProgressEntry({ itemId: 's', text: 'x', happenedOn: 'yesterday' })).toMatchObject({
      ok: false,
    });
  });

  it('reads an empty unit as no unit', () => {
    const result = checkProgressEntry({ itemId: 's', text: 'did 3', quantity: 3, unit: '  ' });
    expect(result.ok && result.value.unit).toBeNull();
  });
});

describe('isProgressEstimate', () => {
  it('knows the three rough answers and nothing else', () => {
    expect(['started', 'half', 'nearly'].every(isProgressEstimate)).toBe(true);
    expect(isProgressEstimate('done')).toBe(false);
    expect(isProgressEstimate(null)).toBe(false);
  });
});

describe('sortProgressEntries', () => {
  it('puts the latest day first, and the later write first within a day', () => {
    const sorted = sortProgressEntries([
      entry('a', { happenedOn: '2026-09-28' }),
      entry('b', { happenedOn: '2026-09-30', createdAt: '2026-09-30T08:00:00Z' }),
      entry('c', { happenedOn: '2026-09-30', createdAt: '2026-09-30T09:00:00Z' }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('tallyProgress', () => {
  it('adds up the amounts in one unit, ignoring case and space', () => {
    const entries = [
      entry('a', { quantity: 2, unit: 'bags' }),
      entry('b', { quantity: 3, unit: ' Bags' }),
      entry('c', { quantity: 5, unit: 'boxes' }),
      entry('d', { estimate: 'half' }),
      entry('e', { quantity: 4 }),
    ];
    expect(tallyProgress(entries, 'bags')).toBe(5);
    expect(tallyProgress(entries, 'boxes')).toBe(5);
    expect(tallyProgress(entries, null)).toBe(4);
    expect(tallyProgress([], 'bags')).toBe(0);
  });
});

describe('summariseProgress', () => {
  it('sums each unit, keeps the newest spelling and the last-touched day', () => {
    const summary = summariseProgress([
      entry('a', { quantity: 2, unit: 'bags', happenedOn: '2026-09-27' }),
      entry('b', { quantity: 5, unit: 'Bags ', happenedOn: '2026-09-29' }),
      entry('c', { quantity: 1, unit: 'boxes', happenedOn: '2026-09-28' }),
      entry('d', { text: 'sorted the shelf', happenedOn: '2026-09-26' }),
      entry('e', { itemId: 'step-2', estimate: 'half', happenedOn: '2026-09-25' }),
    ]);
    expect(summary['step-1'].tallies).toEqual([
      { quantity: 7, unit: 'Bags' },
      { quantity: 1, unit: 'boxes' },
    ]);
    expect(summary['step-1'].lastOn).toBe('2026-09-29');
    expect(summary['step-1'].entries.map((e) => e.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(summary['step-2'].tallies).toEqual([]);
    expect(summary['step-3']).toBeUndefined();
  });
});

describe('tallyWords', () => {
  it('says the tally in plain words', () => {
    expect(tallyWords([{ quantity: 7, unit: 'bags' }])).toBe('7 bags so far');
    expect(
      tallyWords([
        { quantity: 7, unit: 'bags' },
        { quantity: 2.5, unit: 'hours' },
        { quantity: 3, unit: null },
      ]),
    ).toBe('7 bags, 2.5 hours and 3 so far');
    expect(tallyWords([{ quantity: 0.1 + 0.2, unit: 'km' }])).toBe('0.3 km so far');
    expect(tallyWords([])).toBeNull();
  });
});

describe('latestBeneath', () => {
  it('rolls the newest entry beneath each step up to it', () => {
    const tree = [
      {
        id: 'phase',
        title: 'Move in',
        children: [
          { id: 'bags', title: 'Move the bags', children: [] },
          {
            id: 'boxes',
            title: 'Unpack',
            children: [{ id: 'kitchen', title: 'Kitchen boxes', children: [] }],
          },
        ],
      },
      { id: 'lone', title: 'Alone', children: [] },
    ];
    const progress = summariseProgress([
      entry('a', { itemId: 'bags', happenedOn: '2026-09-28' }),
      entry('b', { itemId: 'kitchen', happenedOn: '2026-09-29' }),
      entry('c', { itemId: 'lone', happenedOn: '2026-09-30' }),
    ]);
    const beneath = latestBeneath(tree, progress);
    expect(beneath.phase).toEqual({ on: '2026-09-29', stepId: 'kitchen', title: 'Kitchen boxes' });
    expect(beneath.boxes).toEqual({ on: '2026-09-29', stepId: 'kitchen', title: 'Kitchen boxes' });
    expect(beneath.bags).toBeUndefined();
    expect(beneath.lone).toBeUndefined();
    expect(lastProgressOn(progress)).toBe('2026-09-30');
    expect(lastProgressOn({})).toBeNull();
  });
});

describe('roughly how much is left (plan #1277)', () => {
  it('says about 93 to go when entries add to 7 of an estimated 100 bags', () => {
    const { tallies } = summariseProgress([
      entry('a', { quantity: 5, unit: 'bags' }),
      entry('b', { quantity: 2, unit: 'Bags' }),
    ])['step-1']!;
    const towards = towardsTotal(100, 'bags', tallies)!;
    expect(towards).toEqual({ done: 7, total: 100, left: 93, unit: 'bags' });
    expect(towardsTotalWords(towards)).toBe('7 of about 100 bags, about 93 to go');
  });

  it('counts one bag towards a total of bags, and keeps other units beside it', () => {
    const tallies = [
      { quantity: 1, unit: 'bag' },
      { quantity: 3, unit: 'boxes' },
    ];
    expect(towardsTotal(10, 'bags', tallies)?.done).toBe(1);
    expect(talliesBesideTotal(tallies, 'bags')).toEqual([{ quantity: 3, unit: 'boxes' }]);
  });

  it('says the estimate is reached rather than a negative, and nothing without a total', () => {
    expect(towardsTotalWords(towardsTotal(100, 'bags', [{ quantity: 104, unit: 'bags' }])!)).toBe(
      '104 of about 100 bags, the estimate reached',
    );
    expect(towardsTotal(null, 'bags', [])).toBeNull();
    expect(towardsTotal(100, null, [])).toBeNull();
    expect(towardsTotal(100, 'bags', [])).toMatchObject({ done: 0, left: 100 });
  });
});

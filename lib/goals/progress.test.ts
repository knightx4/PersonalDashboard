import { describe, expect, it } from 'vitest';
import {
  checkProgressEntry,
  entryAmount,
  loggedWhen,
  summariseProgress,
  tallyLine,
  isProgressEstimate,
  sortProgressEntries,
  tallyProgress,
  type ProgressEntry,
} from './progress';
import { formatDay } from './dates';

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
  const tree = [
    {
      id: 'goal',
      status: 'open',
      children: [
        {
          id: 'parent',
          status: 'open',
          children: [
            { id: 'bags', status: 'open', children: [] },
            { id: 'boxes', status: 'done', children: [] },
            { id: 'quiet', status: 'open', children: [] },
          ],
        },
      ],
    },
  ];

  it('sums each unit, ignoring case and space, the newest unit first', () => {
    const out = summariseProgress(
      [
        entry('a', { itemId: 'bags', quantity: 2, unit: 'bags', happenedOn: '2026-09-27' }),
        entry('b', { itemId: 'bags', quantity: 5, unit: ' Bags', happenedOn: '2026-09-28' }),
        entry('c', { itemId: 'bags', quantity: 1, unit: 'boxes', happenedOn: '2026-09-29' }),
        entry('d', { itemId: 'bags', quantity: 0.1, happenedOn: '2026-09-20' }),
        entry('e', { itemId: 'bags', quantity: 0.2, happenedOn: '2026-09-21' }),
        entry('f', { itemId: 'bags', estimate: 'half', happenedOn: '2026-09-22' }),
      ],
      tree,
    );
    expect(out.bags.tallies).toEqual([
      { quantity: 1, unit: 'boxes' },
      { quantity: 7, unit: 'Bags' },
      { quantity: 0.3, unit: null },
    ]);
    expect(out.bags.count).toBe(6);
    expect(out.bags.entries.map((e) => e.id)).toEqual(['c', 'b', 'a', 'f', 'e', 'd']);
    expect(out.bags.lastOn).toBe('2026-09-29');
    expect(out.bags.underWay).toBe(true);
  });

  it('rolls the latest day up to the parent and the goal without making them under way', () => {
    const out = summariseProgress(
      [
        entry('a', { itemId: 'bags', happenedOn: '2026-09-27' }),
        entry('b', { itemId: 'boxes', happenedOn: '2026-09-29' }),
        entry('g', { itemId: 'goal', quantity: 50, unit: 'pounds', happenedOn: '2026-09-20' }),
      ],
      tree,
    );
    expect(out.parent).toMatchObject({ count: 0, lastOn: null, latestOn: '2026-09-29', underWay: false });
    expect(out.goal).toMatchObject({ count: 1, lastOn: '2026-09-20', latestOn: '2026-09-29', underWay: true });
    expect(out.goal.tallies).toEqual([{ quantity: 50, unit: 'pounds' }]);
    // A finished step with entries keeps them but is not under way.
    expect(out.boxes.underWay).toBe(false);
    // A step with nothing on it or beneath it has no summary at all.
    expect(out.quiet).toBeUndefined();
  });

  it('summarises entries on items outside the tree', () => {
    const out = summariseProgress([entry('a', { itemId: 'elsewhere' })]);
    expect(out.elsewhere).toMatchObject({ count: 1, underWay: true, latestOn: '2026-09-30' });
  });
});

describe('the words', () => {
  it('says the tally in plain words', () => {
    expect(tallyLine([])).toBeNull();
    expect(tallyLine([{ quantity: 7, unit: 'bags' }])).toBe('7 bags so far');
    expect(
      tallyLine([
        { quantity: 7, unit: 'bags' },
        { quantity: 2, unit: 'boxes' },
        { quantity: 1.5, unit: null },
      ]),
    ).toBe('7 bags, 2 boxes and 1.5 so far');
  });

  it("says one entry's amount or estimate", () => {
    expect(entryAmount(entry('a', { quantity: 2, unit: 'bags' }))).toBe('2 bags');
    expect(entryAmount(entry('a', { estimate: 'nearly' }))).toBe('Nearly done');
    expect(entryAmount(entry('a'))).toBeNull();
  });

  it('says when, relative within the week and as a date after', () => {
    expect(loggedWhen('2026-09-30', '2026-09-30')).toBe('today');
    expect(loggedWhen('2026-09-29', '2026-09-30')).toBe('yesterday');
    expect(loggedWhen('2026-09-28', '2026-09-30')).toBe('2 days ago');
    expect(loggedWhen('2026-09-12', '2026-09-30')).toBe(formatDay('2026-09-12'));
    expect(loggedWhen('2025-12-30', '2026-01-02')).toBe('3 days ago');
    expect(loggedWhen('2025-11-30', '2026-01-02')).toBe(formatDay('2025-11-30', true));
  });
});

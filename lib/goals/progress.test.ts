import { describe, expect, it } from 'vitest';
import {
  checkProgressEntry,
  isProgressEstimate,
  sortProgressEntries,
  tallyProgress,
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

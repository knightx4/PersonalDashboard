import { describe, expect, it } from 'vitest';
import { membershipChange, reconcilePlaces, type StoredPlace } from './reconcile';

const ids = (prefix: string, count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => `${prefix}${from + i}`);

function stored(id: string, members: string[], name: string | null = `Place ${id}`): StoredPlace {
  return { id, name, namedMembers: name ? members : [], members };
}

describe('membershipChange', () => {
  it('is 0 for the same ideas and 1 for none in common', () => {
    expect(membershipChange(['a', 'b'], ['b', 'a'])).toBe(0);
    expect(membershipChange(['a', 'b'], ['c'])).toBe(1);
    expect(membershipChange([], [])).toBe(0);
  });

  it('counts the ideas in one and not the other over the ideas in either', () => {
    // Nine named, three added: three of twelve.
    expect(membershipChange(ids('a', 9), ids('a', 12))).toBeCloseTo(0.25);
  });
});

describe('reconcilePlaces', () => {
  it('keeps the id and name of a place whose ideas barely changed', () => {
    const before = stored('p1', ids('a', 9));
    const result = reconcilePlaces([before], [ids('a', 10)]);
    expect(result).toEqual({ kept: [{ id: 'p1', members: ids('a', 10), needsName: false }], added: [], removed: [] });
  });

  it('names a place again once its ideas have changed by more than a third since it was named', () => {
    const before = stored('p1', ids('a', 6));
    const result = reconcilePlaces([before], [[...ids('a', 4), ...ids('b', 3)]]);
    expect(result.kept).toEqual([{ id: 'p1', members: [...ids('a', 4), ...ids('b', 3)], needsName: true }]);
  });

  it('measures drift from the ideas it was named for, not yesterday’s', () => {
    // Named for a0..a8; yesterday a9..a10 had joined; today two more. Each day
    // is a small step, but from the naming it is past a third.
    const before: StoredPlace = { id: 'p1', name: 'Kept', namedMembers: ids('a', 9), members: ids('a', 11) };
    expect(reconcilePlaces([before], [ids('a', 13)]).kept[0]!.needsName).toBe(false);
    expect(reconcilePlaces([before], [ids('a', 14)]).kept[0]!.needsName).toBe(true);
  });

  it('asks for a name for a place that has none yet', () => {
    const result = reconcilePlaces([stored('p1', ids('a', 5), null)], [ids('a', 5)]);
    expect(result.kept[0]!.needsName).toBe(true);
  });

  it('adds new places and removes ones that did not come back', () => {
    const result = reconcilePlaces([stored('p1', ids('a', 5)), stored('p2', ids('z', 5))], [ids('a', 5), ids('n', 4)]);
    expect(result.kept.map((p) => p.id)).toEqual(['p1']);
    expect(result.added).toEqual([ids('n', 4)]);
    expect(result.removed).toEqual(['p2']);
  });

  it('gives a split place’s id to the bigger half and makes the other half new', () => {
    const before = stored('p1', ids('a', 20));
    const result = reconcilePlaces([before], [ids('a', 8, 12), ids('a', 12)]);
    expect(result.kept).toEqual([{ id: 'p1', members: ids('a', 12), needsName: true }]);
    expect(result.added).toEqual([ids('a', 8, 12)]);
    expect(result.removed).toEqual([]);
  });
});

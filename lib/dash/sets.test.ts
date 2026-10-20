import { describe, expect, it } from 'vitest';
import { parseSetName, rowsOfSet, SET_CAP, type DashSeen, type RowSet } from './sets';

const seenWith = (...sets: RowSet[]): DashSeen => Object.assign(() => false, { sets: new Map(sets.map((s) => [s.name, s])) });

describe('rowsOfSet (plan #2472.1)', () => {
  const items: RowSet = { name: 'set 1', table: 'shopping.items', refs: ['a', 'b'], size: 2 };

  it('reads a set name however the model writes it', () => {
    expect(['set 1', 'Set 1', ' set1 ', '1', 1].map(parseSetName)).toEqual(Array(5).fill('set 1'));
    expect(['set 0', 'set one', '', null, 1.5].map(parseSetName)).toEqual(Array(5).fill(null));
  });

  it('turns a set into its table and ids, for any of the tables a write takes', () => {
    expect(rowsOfSet(seenWith(items), 'set 1', ['shopping.orders', 'shopping.items'])).toEqual({
      ok: true,
      name: 'set 1',
      table: 'shopping.items',
      ids: ['a', 'b'],
    });
  });

  it('refuses a name that is not a set, and a seen check that carries none', () => {
    expect(rowsOfSet(seenWith(items), 'my items', 'shopping.items')).toMatchObject({
      ok: false,
      error: expect.stringContaining('such as "set 1"'),
    });
    expect(rowsOfSet(() => true, 'set 1', 'shopping.items')).toMatchObject({
      ok: false,
      error: expect.stringContaining('No lookup in this answer has made one yet.'),
    });
    expect(rowsOfSet(seenWith(items), 'set 2', 'shopping.items')).toMatchObject({
      ok: false,
      error: expect.stringContaining('The sets so far are set 1.'),
    });
  });

  it('refuses a set of another table than the write works on', () => {
    expect(rowsOfSet(seenWith(items), 'set 1', 'job_search.roles')).toEqual({
      ok: false,
      error: 'set 1 holds rows of shopping.items, and this change works on job_search.roles.',
    });
  });

  it('refuses a set from a lookup that matched nothing', () => {
    const empty: RowSet = { name: 'set 1', table: 'shopping.items', refs: [], size: 0 };
    expect(rowsOfSet(seenWith(empty), 'set 1', 'shopping.items')).toEqual({
      ok: false,
      error: 'set 1 is empty: its lookup matched no rows, so there is nothing to change.',
    });
  });

  it('refuses a set over the cap, saying its size', () => {
    const big: RowSet = { name: 'set 1', table: 'shopping.items', refs: [], size: SET_CAP + 37 };
    expect(rowsOfSet(seenWith(big), 'set 1', 'shopping.items')).toMatchObject({
      ok: false,
      error: expect.stringContaining(`set 1 holds ${SET_CAP + 37} rows, more than the ${SET_CAP} one change can take.`),
    });
  });
});

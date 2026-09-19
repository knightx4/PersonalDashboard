import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inventoryItemIdsForFilter } from './select-items';

/**
 * What the item picker asks the database for when a share names a `q`.
 *
 * The name and the short name used to be matched from inside one `or`
 * expression. PostgREST reads a comma in one of those as the separator between
 * its sides, so "Settlers of Catan, 5-6 player" sent a filter that does not
 * parse and the picker put nothing on the share. Two `ilike` reads now, each
 * carrying the same category, tag and status conditions, merged by id.
 */

type Row = { id: string };

const ilikes: Array<[string, string]> = [];
const ors: string[] = [];
let eqs: Array<Array<[string, unknown]>> = [];
let rows: { byName?: Row[]; byShortName?: Row[]; all?: Row[] } = {};

/**
 * A stand-in for the caller's client: enough of the builder for the reads the
 * picker makes, recording the filters each read was given separately so the
 * conditions can be checked to reach both of them.
 */
function client(): SupabaseClient {
  return {
    from() {
      const mine: Array<[string, unknown]> = [];
      eqs.push(mine);
      let matched: Row[] = rows.all ?? [];

      const read = {
        select: () => read,
        eq(column: string, value: unknown) {
          mine.push([column, value]);
          return read;
        },
        // Kept on the stub although nothing should call it: an `or` is what a
        // comma in the `q` broke, so one has to show up in the assertions
        // rather than pass unnoticed.
        or(expression: string) {
          ors.push(expression);
          return read;
        },
        ilike(column: string, pattern: string) {
          ilikes.push([column, pattern]);
          matched = (column === 'name' ? rows.byName : rows.byShortName) ?? [];
          return read;
        },
        then<T>(onFulfilled: (result: { data: Row[]; error: null }) => T) {
          return Promise.resolve({ data: matched, error: null }).then(onFulfilled);
        },
      };

      return read;
    },
  } as unknown as SupabaseClient;
}

describe('inventoryItemIdsForFilter', () => {
  beforeEach(() => {
    ilikes.length = 0;
    ors.length = 0;
    eqs = [];
    rows = {};
  });

  it('matches a q with a comma in it', async () => {
    rows = { byName: [{ id: 'item-1' }], byShortName: [] };

    const ids = await inventoryItemIdsForFilter(client(), 'user-1', {
      q: 'Catan, 5-6 player',
    });

    expect(ids).toEqual(['item-1']);
    expect(ors).toEqual([]);
    expect(ilikes).toEqual([
      ['name', '%Catan, 5-6 player%'],
      ['short_name', '%Catan, 5-6 player%'],
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    await inventoryItemIdsForFilter(client(), 'user-1', { q: '50%_off' });

    expect(ilikes).toEqual([
      ['name', '%50\\%\\_off%'],
      ['short_name', '%50\\%\\_off%'],
    ]);
  });

  it('gives both reads the same conditions', async () => {
    await inventoryItemIdsForFilter(client(), 'user-1', {
      q: 'catan',
      categorySlug: 'board-games',
    });

    expect(eqs).toHaveLength(2);
    expect(eqs[0]).toEqual([
      ['user_id', 'user-1'],
      ['status', 'owned'],
      ['categories.slug', 'board-games'],
    ]);
    expect(eqs[1]).toEqual(eqs[0]);
  });

  it('lists an item once when its name and its short name both match', async () => {
    rows = { byName: [{ id: 'item-1' }], byShortName: [{ id: 'item-1' }, { id: 'item-2' }] };

    const ids = await inventoryItemIdsForFilter(client(), 'user-1', { q: 'catan' });

    expect(ids).toEqual(['item-1', 'item-2']);
  });

  it('makes one read and sends no pattern without a q', async () => {
    rows = { all: [{ id: 'item-1' }] };

    const ids = await inventoryItemIdsForFilter(client(), 'user-1', { categorySlug: 'books' });

    expect(ids).toEqual(['item-1']);
    expect(eqs).toHaveLength(1);
    expect(ilikes).toEqual([]);
    expect(ors).toEqual([]);
  });
});

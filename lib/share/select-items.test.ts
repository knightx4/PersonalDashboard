import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inventoryItemIdsForFilter } from '@/lib/share/select-items';

/**
 * What the item picker asks the database for when a share says "everything
 * matching this".
 *
 * Stubbed rather than run against Postgres: what is worth checking is the
 * filters that go out and the ids that come back, and the stub below has no
 * `or` method at all, so a search that went back to building an `or`
 * expression would fail here rather than quietly match nothing.
 */

type Row = { id: string };

type Read = { column: string | null; term: string | null };

/** Rows keyed by the column the read matched on; `all` for an unfiltered read. */
type Rows = { name?: Row[]; short_name?: Row[]; all?: Row[] };

function recordingClient(rows: Rows = {}) {
  const reads: Read[] = [];

  const supabase = {
    from() {
      return {
        select() {
          const read: Read & {
            eq: () => typeof read;
            ilike: (column: string, term: string) => typeof read;
            then: (resolve: (result: { data: Row[]; error: null }) => void) => void;
          } = {
            column: null,
            term: null,
            eq: () => read,
            ilike(column: string, term: string) {
              read.column = column;
              read.term = term;
              return read;
            },
            then(resolve) {
              reads.push({ column: read.column, term: read.term });
              const matched =
                read.column === 'name'
                  ? (rows.name ?? [])
                  : read.column === 'short_name'
                    ? (rows.short_name ?? [])
                    : (rows.all ?? []);
              resolve({ data: matched, error: null });
            },
          };
          return read;
        },
      };
    },
  };

  return { supabase: supabase as unknown as SupabaseClient, reads };
}

describe('inventoryItemIdsForFilter', () => {
  it('matches a phrase with a comma in it', async () => {
    const stub = recordingClient({
      name: [{ id: 'item-1' }],
      short_name: [],
    });

    const ids = await inventoryItemIdsForFilter(stub.supabase, 'user-1', {
      q: 'Chess, travel set',
    });

    expect(ids).toEqual(['item-1']);
    // The comma goes out as part of the pattern rather than splitting it.
    expect(stub.reads).toEqual([
      { column: 'name', term: '%Chess, travel set%' },
      { column: 'short_name', term: '%Chess, travel set%' },
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    const stub = recordingClient();

    await inventoryItemIdsForFilter(stub.supabase, 'user-1', { q: '50%_off' });

    expect(stub.reads).toEqual([
      { column: 'name', term: '%50\\%\\_off%' },
      { column: 'short_name', term: '%50\\%\\_off%' },
    ]);
  });

  it('lists an item once when both its names match', async () => {
    const stub = recordingClient({
      name: [{ id: 'item-1' }, { id: 'item-2' }],
      short_name: [{ id: 'item-1' }],
    });

    const ids = await inventoryItemIdsForFilter(stub.supabase, 'user-1', { q: 'chess' });

    expect(ids).toEqual(['item-1', 'item-2']);
  });

  it('reads once, unfiltered, without a search', async () => {
    const stub = recordingClient({ all: [{ id: 'item-1' }] });

    const ids = await inventoryItemIdsForFilter(stub.supabase, 'user-1', {
      categorySlug: 'board-games',
    });

    expect(ids).toEqual(['item-1']);
    expect(stub.reads).toEqual([{ column: null, term: null }]);
  });
});

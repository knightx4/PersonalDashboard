import { describe, expect, it, vi } from 'vitest';

/**
 * What the command box asks the vault for.
 *
 * Stubbed rather than run against Postgres: the filters that go out and the
 * notes that come back are the whole of it, and the stub has no `or` method,
 * so a search that went back to building an `or` expression would fail here
 * rather than silently drop the vault from the results -- which is how a
 * comma used to show up, since the box drops a source that throws.
 */

type NoteRow = { id: string; title: string | null; path: string };

type Rows = { title?: NoteRow[]; path?: NoteRow[]; all?: NoteRow[] };

const stub = vi.hoisted(() => ({
  rows: {} as Rows,
  reads: [] as Array<{ column: string | null; pattern: string | null; limit: number }>,
}));

vi.mock('@/lib/vault/auth/server', () => ({
  createVaultClient: async () => ({
    from() {
      return {
        select() {
          const read = {
            column: null as string | null,
            pattern: null as string | null,
            ilike(column: string, pattern: string) {
              read.column = column;
              read.pattern = pattern;
              return read;
            },
            order: () => read,
            limit: async (limit: number) => {
              stub.reads.push({ column: read.column, pattern: read.pattern, limit });
              const matched =
                read.column === 'title'
                  ? (stub.rows.title ?? [])
                  : read.column === 'path'
                    ? (stub.rows.path ?? [])
                    : (stub.rows.all ?? []);
              return { data: matched, error: null };
            },
          };
          return read;
        },
      };
    },
  }),
}));

import { vaultSearchSource } from '@/lib/search/sources/vault';

function given(rows: Rows = {}) {
  stub.rows = rows;
  stub.reads.length = 0;
}

const note = (id: string, title: string | null, path: string): NoteRow => ({ id, title, path });

describe('vaultSearchSource', () => {
  it('matches a phrase with a comma in it', async () => {
    given({ title: [note('n1', 'Value, price and profit', 'econ/value.md')] });

    const hits = await vaultSearchSource.find({
      userId: 'user-1',
      query: 'value, price',
      limit: 6,
    });

    expect(hits.map((hit) => hit.title)).toEqual(['Value, price and profit']);
    // The comma is part of the pattern rather than the separator between two
    // conditions, which is what it was inside an `or`.
    expect(stub.reads).toEqual([
      { column: 'title', pattern: '%value, price%', limit: 6 },
      { column: 'path', pattern: '%value, price%', limit: 6 },
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    given();

    await vaultSearchSource.find({ userId: 'user-1', query: '50%_off', limit: 6 });

    expect(stub.reads).toEqual([
      { column: 'title', pattern: '%50\\%\\_off%', limit: 6 },
      { column: 'path', pattern: '%50\\%\\_off%', limit: 6 },
    ]);
  });

  it('lists a note once when its title and its path both match', async () => {
    given({
      title: [note('n1', 'Chess', 'games/chess.md')],
      path: [note('n1', 'Chess', 'games/chess.md'), note('n2', null, 'games/chess-openings.md')],
    });

    const hits = await vaultSearchSource.find({ userId: 'user-1', query: 'chess', limit: 6 });

    expect(hits.map((hit) => hit.id)).toEqual(['n1', 'n2']);
    // A note with no title is known by its filename.
    expect(hits[1].title).toBe('chess-openings.md');
  });

  it('reads once, unfiltered, for the whole list', async () => {
    given({ all: [note('n1', 'Chess', 'games/chess.md')] });

    const hits = await vaultSearchSource.list({ userId: 'user-1', limit: 500 });

    expect(hits.map((hit) => hit.id)).toEqual(['n1']);
    expect(stub.reads).toEqual([{ column: null, pattern: null, limit: 500 }]);
  });
});

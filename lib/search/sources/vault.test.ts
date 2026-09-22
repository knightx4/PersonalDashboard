import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a note search asks the database for, and which notes it keeps.
 *
 * Stubbed rather than run against Postgres: what is being checked is the shape
 * of the reads -- two `ilike`s rather than one `or` over title and path -- and
 * the merge that puts their rows back into one list. A comma used to go out
 * inside that `or`, where PostgREST reads it as the separator between the two
 * sides, and the palette dropped the whole source rather than failing, so the
 * symptom was a search that quietly found no notes.
 */

type NoteRow = { id: string; title: string | null; path: string; updated_at: string | null };

type Rows = {
  /** Notes whose title matched. */
  byTitle?: NoteRow[];
  /** Notes whose path matched. */
  byPath?: NoteRow[];
  /** What comes back with no query at all. */
  all?: NoteRow[];
};

const ilikes: Array<[string, string]> = [];
const ors: string[] = [];
const limits: number[] = [];
let rows: Rows = {};

/**
 * A stand-in for the vault client: enough of the builder for the reads the
 * source makes, recording every filter it was given.
 */
function client() {
  return {
    from(table: string) {
      expect(table).toBe('notes');

      let matched: NoteRow[] = rows.all ?? [];
      const read = {
        select: () => read,
        // Kept on the stub although nothing should call it: an `or` is what a
        // comma in the query broke, so one has to show up in the assertions
        // rather than pass unnoticed.
        or(expression: string) {
          ors.push(expression);
          return read;
        },
        ilike(column: string, pattern: string) {
          ilikes.push([column, pattern]);
          matched = (column === 'title' ? rows.byTitle : rows.byPath) ?? [];
          return read;
        },
        order: () => read,
        limit(count: number) {
          limits.push(count);
          return Promise.resolve({ data: matched, error: null });
        },
      };

      return read as never;
    },
  };
}

vi.mock('@/lib/vault/auth/server', () => ({ createVaultClient: async () => client() }));

const { vaultSearchSource } = await import('./vault');

function note(id: string, title: string | null, path: string, updatedAt: string): NoteRow {
  return { id, title, path, updated_at: updatedAt };
}

function find(query: string, limit = 10) {
  return vaultSearchSource.find({ userId: 'user-1', limit, query });
}

describe('vaultSearchSource', () => {
  beforeEach(() => {
    ilikes.length = 0;
    ors.length = 0;
    limits.length = 0;
    rows = {};
  });


  it('finds a note by a phrase with a comma in it', async () => {
    rows = {
      byTitle: [note('n1', 'Value, price and profit', 'econ/value.md', '2026-03-01T00:00:00Z')],
      byPath: [],
    };

    const hits = await find('value, price');

    expect(hits.map((hit) => hit.id)).toEqual(['n1']);
    // The comma goes out as part of an `ilike` value, not as part of an `or`
    // expression, which is the whole of the fix.
    expect(ors).toEqual([]);
    expect(ilikes).toEqual([
      ['title', '%value, price%'],
      ['path', '%value, price%'],
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    rows = { byTitle: [], byPath: [] };

    await find('50%');
    await find('a_b');

    expect(ilikes).toEqual([
      ['title', '%50\\%%'],
      ['path', '%50\\%%'],
      ['title', '%a\\_b%'],
      ['path', '%a\\_b%'],
    ]);
  });

  it('lists a note once when its title and its path both match', async () => {
    const both = note('n1', 'Pricing', 'econ/pricing.md', '2026-03-01T00:00:00Z');
    rows = { byTitle: [both], byPath: [both] };

    const hits = await find('pricing');

    expect(hits.map((hit) => hit.id)).toEqual(['n1']);
  });

  it('puts the two reads back in date order and caps them together', async () => {
    rows = {
      byTitle: [
        note('n1', 'March note', 'a/march.md', '2026-03-01T00:00:00Z'),
        note('n2', 'January note', 'a/january.md', '2026-01-01T00:00:00Z'),
      ],
      byPath: [note('n3', 'February', 'march/february.md', '2026-02-01T00:00:00Z')],
    };

    const hits = await find('march', 2);

    // Newest first across both reads, and cut to the limit the caller asked
    // for rather than to twice it.
    expect(hits.map((hit) => hit.id)).toEqual(['n1', 'n3']);
    // Each read still takes the full limit of its own, so neither can be
    // starved by the other.
    expect(limits).toEqual([2, 2]);
  });

  it('sends no filter when there is no query', async () => {
    rows = { all: [note('n1', 'Anything', 'a/anything.md', '2026-03-01T00:00:00Z')] };

    const hits = await vaultSearchSource.list({ userId: 'user-1', limit: 10 });

    expect(hits.map((hit) => hit.id)).toEqual(['n1']);
    expect(ilikes).toEqual([]);
    expect(ors).toEqual([]);
  });
});

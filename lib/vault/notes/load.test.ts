import { describe, expect, it } from 'vitest';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { loadNotes } from './load';

/**
 * Reading the note list with a fake vault client (plan #1377): every note
 * comes back however many there are, no request asks for a body, a caller's
 * own limit still holds, and the excerpt is cut from the stored opening.
 */

type Row = { id: string; path: string; title: string; opening: string; git_updated_at: null };

/**
 * Just enough of supabase-js for loadNotes. Like PostgREST, it never returns
 * more than 1,000 rows to one request, so a reader that does not page loses
 * the rest.
 */
function fakeVault(rows: Row[]) {
  const requests: { columns: string; from: number; to: number }[] = [];
  const client = {
    from: () => {
      let columns = '';
      const query = {
        select(cols: string) {
          columns = cols;
          return query;
        },
        is: () => query,
        textSearch: () => query,
        like: () => query,
        order: () => query,
        async range(from: number, to: number) {
          requests.push({ columns, from, to });
          const end = Math.min(to + 1, from + 1000);
          return { data: rows.slice(from, end), error: null };
        },
      };
      return query;
    },
  };
  return { client: client as unknown as VaultSupabaseClient, requests };
}

function notes(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i).padStart(4, '0');
    return { id: `id-${n}`, path: `f/${n}.md`, title: n, opening: `Note ${n}`, git_updated_at: null };
  });
}

describe('loadNotes', () => {
  it('returns every note when the vault holds more than a thousand', async () => {
    const { client, requests } = fakeVault(notes(2296));
    const list = await loadNotes(client);

    expect(list).toHaveLength(2296);
    expect(list.at(-1)?.path).toBe('f/2295.md');
    expect(new Set(list.map((note) => note.id)).size).toBe(2296);
    expect(requests.map((r) => [r.from, r.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('reads the opening and never the body', async () => {
    const { client, requests } = fakeVault(notes(3));
    await loadNotes(client);

    expect(requests[0].columns.split(',').map((c) => c.trim())).toEqual(
      expect.arrayContaining(['opening']),
    );
    expect(requests[0].columns).not.toMatch(/\bbody\b/);
  });

  it('stops at a limit the caller passes', async () => {
    const { client, requests } = fakeVault(notes(1500));
    const list = await loadNotes(client, { limit: 500 });

    expect(list).toHaveLength(500);
    expect(requests).toEqual([{ columns: expect.any(String), from: 0, to: 499 }]);
  });

  it('cuts the excerpt from the opening as it did from the body', async () => {
    const opening = `# Heading\n\n**Bold** start ${'word '.repeat(60)}`;
    const { client } = fakeVault([
      { id: 'a', path: 'a.md', title: 'a', opening, git_updated_at: null },
    ]);
    const [note] = await loadNotes(client);

    expect(note.excerpt.startsWith('Heading Bold start word word')).toBe(true);
    expect(note.excerpt).toHaveLength(180);
    expect(note.excerpt.endsWith('…')).toBe(true);
  });
});

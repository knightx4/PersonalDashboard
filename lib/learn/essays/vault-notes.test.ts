import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { NOTE_SEARCH_LIMIT, searchVaultNotes } from './vault-notes';

type Row = Record<string, unknown>;

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** A notes table that applies ilike with its wildcards, as Postgres does, and records the pattern. */
function fakes(notes: Row[], essayNoteId: string | null) {
  const patterns: string[] = [];
  const vault = {
    from: () => {
      let rows = [...notes];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.ilike = (_c: string, pattern: string) => {
        patterns.push(pattern);
        let source = '';
        for (let i = 0; i < pattern.length; i += 1) {
          const ch = pattern[i];
          if (ch === '\\') source += (pattern[(i += 1)] ?? '').replace(SPECIAL, '\\$&');
          else if (ch === '%') source += '.*';
          else if (ch === '_') source += '.';
          else source += ch.replace(SPECIAL, '\\$&');
        }
        const re = new RegExp(`^${source}$`, 'i');
        rows = rows.filter((r) => re.test(r.title as string));
        return q;
      };
      q.is = (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q);
      q.neq = (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] !== v)), q);
      q.order = (c: string) => ((rows = rows.sort((a, b) => String(b[c]).localeCompare(String(a[c])))), q);
      q.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
      return q;
    },
  } as unknown as VaultSupabaseClient;
  const learn = {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = () => Promise.resolve({ data: { note_id: essayNoteId }, error: null });
      return q;
    },
  } as unknown as LearnSupabaseClient;
  return { vault, learn, patterns };
}

const note = (id: string, title: string, extra: Row = {}): Row => ({
  id,
  path: `${title}.md`,
  title,
  deleted_at: null,
  updated_at: `2026-10-${id.padStart(2, '0')}`,
  ...extra,
});

describe('searchVaultNotes', () => {
  it('returns nothing for an empty or blank query', async () => {
    const { learn, vault, patterns } = fakes([note('1', 'Stoicism')], null);
    expect(await searchVaultNotes(learn, vault, 'e', '')).toEqual([]);
    expect(await searchVaultNotes(learn, vault, 'e', '   ')).toEqual([]);
    expect(patterns).toEqual([]);
  });

  it('matches part of a title in any case, newest first, as id, path and title', async () => {
    const { learn, vault } = fakes([note('1', 'Stoicism'), note('2', 'On stoic virtue'), note('3', 'Cooking')], null);
    expect(await searchVaultNotes(learn, vault, 'e', 'STOIC')).toEqual([
      { id: '2', path: 'On stoic virtue.md', title: 'On stoic virtue' },
      { id: '1', path: 'Stoicism.md', title: 'Stoicism' },
    ]);
  });

  it('treats a percent sign in the query as a character, not a wildcard', async () => {
    const { learn, vault, patterns } = fakes([note('1', '100% rule'), note('2', '100 apples')], null);
    expect((await searchVaultNotes(learn, vault, 'e', '100%')).map((n) => n.id)).toEqual(['1']);
    expect(patterns).toEqual(['%100\\%%']);
  });

  it("leaves out a deleted note and the essay's own note", async () => {
    const { learn, vault } = fakes(
      [note('1', 'Stoic gone', { deleted_at: '2026-10-01' }), note('2', 'Stoic essay'), note('3', 'Stoic kept')],
      '2',
    );
    expect((await searchVaultNotes(learn, vault, 'e', 'stoic')).map((n) => n.id)).toEqual(['3']);
  });

  it('returns at most ten', async () => {
    const many = Array.from({ length: 15 }, (_, i) => note(String(i + 1), `Note ${i}`));
    const { learn, vault } = fakes(many, null);
    expect(await searchVaultNotes(learn, vault, 'e', 'note')).toHaveLength(NOTE_SEARCH_LIMIT);
  });
});

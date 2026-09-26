import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import {
  findRelatedNotes,
  matchText,
  matchTextHash,
  MATCH_TEXT_MAX_CHARS,
  RELATED_NOTE_MIN_SIMILARITY,
  RELATED_NOTES_SHOWN,
  type RelatedNotesPorts,
} from '@/lib/vault/notes/related';

/**
 * The cache and the floor, not the SQL. obsidian.nearest_notes is in
 * migrations-vault/0022 and is covered for RLS and soft deletes in
 * tests/rls-vault.test.ts.
 */

const vector = (): number[] => new Array(EMBEDDING_DIMENSIONS).fill(0.01);

function fakePorts(rows: { note_id: string; path: string; title: string | null; similarity: number }[]) {
  const kept = new Map<string, number[]>();
  const embedded: string[] = [];
  const spent: SpendReport[] = [];
  const asked: { limit: number; minSimilarity: number; exclude: string[] }[] = [];

  const ports: RelatedNotesPorts = {
    async cached(hash) {
      return kept.get(hash) ?? null;
    },
    async keep(hash, made) {
      kept.set(hash, made.vector);
    },
    async embed(text, onSpend) {
      embedded.push(text);
      onSpend({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 10 } });
      return { vector: vector(), model: 'voyage-4-lite' };
    },
    async nearest(_vector, options) {
      asked.push(options);
      return rows;
    },
    async ledger(report) {
      spent.push(report);
    },
  };
  return { ports, kept, embedded, spent, asked };
}

describe('findRelatedNotes', () => {
  it('embeds a text once and reads it from the cache after that', async () => {
    const fake = fakePorts([]);
    await findRelatedNotes(fake.ports, 'Rates held at 4%');
    await findRelatedNotes(fake.ports, '  Rates   held at 4% ');
    expect(fake.embedded).toEqual(['Rates held at 4%']);
    expect(fake.spent).toHaveLength(1);
    expect(fake.kept.has(matchTextHash('Rates held at 4%'))).toBe(true);
  });

  it('asks for two at the threshold by default and passes what to leave out', async () => {
    const fake = fakePorts([]);
    await findRelatedNotes(fake.ports, 'x');
    await findRelatedNotes(fake.ports, 'x', { exclude: ['n1'], limit: 5, minSimilarity: 0.7 });
    expect(fake.asked).toEqual([
      { limit: RELATED_NOTES_SHOWN, minSimilarity: RELATED_NOTE_MIN_SIMILARITY, exclude: [] },
      { limit: 5, minSimilarity: 0.7, exclude: ['n1'] },
    ]);
  });

  it('returns the notes that clear the floor, with a link to each', async () => {
    const fake = fakePorts([
      { note_id: 'a', path: 'Money/On rates.md', title: 'On rates', similarity: 0.72 },
      { note_id: 'b', path: 'Misc/Untitled.md', title: null, similarity: 0.2 },
    ]);
    const found = await findRelatedNotes(fake.ports, 'Rates held');
    expect(found).toEqual([
      {
        noteId: 'a',
        path: 'Money/On rates.md',
        title: 'On rates',
        similarity: 0.72,
        href: '/vault/n/Money/On%20rates.md',
      },
    ]);
  });

  it('asks for nothing when there is no text', async () => {
    const fake = fakePorts([]);
    expect(await findRelatedNotes(fake.ports, '   \n ')).toEqual([]);
    expect(fake.embedded).toEqual([]);
    expect(fake.asked).toEqual([]);
  });

  it('returns nothing when the text cannot be embedded', async () => {
    const fake = fakePorts([{ note_id: 'a', path: 'a.md', title: 'a', similarity: 0.9 }]);
    fake.ports.embed = async () => null;
    expect(await findRelatedNotes(fake.ports, 'Rates held')).toEqual([]);
    expect(fake.kept.size).toBe(0);
  });
});

describe('matchText', () => {
  it('closes up whitespace and cuts a long text', () => {
    expect(matchText(' a\n\n b\t c ')).toBe('a b c');
    expect(matchText('x'.repeat(MATCH_TEXT_MAX_CHARS + 50))).toHaveLength(MATCH_TEXT_MAX_CHARS);
  });
});

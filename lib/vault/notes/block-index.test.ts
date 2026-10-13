import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import { runBlockIndex, type BlockIndexPorts, type StoredBlock } from '@/lib/vault/notes/block-index';

/**
 * The loop, not the SQL. obsidian.store_note_blocks and stale_note_blocks
 * (migrations-vault/0035) were tried against the live vault in a rolled-back
 * transaction when applied: a store took the note off the stale list, a block
 * sent without a vector kept the one it had, a store with another hash wrote
 * nothing, and nearest_note_blocks read the passage back out of the body.
 */

type Note = { id: string; userId: string; path: string; body: string };

const sourceHash = (note: Note): string =>
  createHash('md5').update(`${note.path}\n${note.body}`).digest('hex');
const vector = (): number[] => new Array(EMBEDDING_DIMENSIONS).fill(0.01);

/** A vault in memory that behaves like the functions in 0035. */
function fakeVault(notes: Note[]) {
  const stored = new Map<string, { source: string; rows: (StoredBlock & { has: boolean })[] }>();
  const calls: string[][] = [];

  const ports: BlockIndexPorts = {
    async stale(limit) {
      return notes
        .filter((n) => n.body.trim() !== '' && stored.get(n.id)?.source !== sourceHash(n))
        .slice(0, limit)
        .map((n) => ({ noteId: n.id, userId: n.userId, path: n.path, title: null, body: n.body, sourceHash: sourceHash(n) }));
    },
    async embedded(noteIds) {
      const out = new Set<string>();
      for (const id of noteIds) {
        for (const row of stored.get(id)?.rows ?? []) if (row.has) out.add(`${id}:${row.text_hash}`);
      }
      return out;
    },
    async store(noteId, source, rows) {
      const n = notes.find((x) => x.id === noteId)!;
      if (sourceHash(n) !== source) return 0;
      const old = stored.get(noteId)?.rows ?? [];
      stored.set(noteId, {
        source,
        rows: rows.map((row) => ({
          ...row,
          has: row.embedding !== null || old.some((o) => o.has && o.text_hash === row.text_hash),
        })),
      });
      return rows.length;
    },
    async embed({ texts, onSpend }) {
      calls.push(texts);
      onSpend({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: texts.length } });
      return { ok: true, vectors: texts.map(() => vector()), model: 'voyage-4-lite', tokens: texts.length };
    },
  };
  return { ports, stored, calls };
}

const body = (second: string) =>
  `# One\nThe first section says one thing at some length.\n# Two\n${second}\n# Three\nA third section with words enough.`;

describe('runBlockIndex', () => {
  it('stores blocks for every note and embeds each searchable one', async () => {
    const notes = [
      { id: 'n1', userId: 'u1', path: 'A/One.md', body: body('The second section says another thing.') },
      { id: 'n2', userId: 'u1', path: 'B/Two.md', body: '# Only a heading' },
    ];
    const vault = fakeVault(notes);
    const result = await runBlockIndex(vault.ports);
    expect(result).toMatchObject({ notes: 2, blocks: 4, embedded: 3, stopped: null });
    expect(vault.stored.get('n2')!.rows[0].embedding).toBeNull();
  });

  it('re-embeds only the block whose paragraph changed', async () => {
    const notes = [{ id: 'n1', userId: 'u1', path: 'A/One.md', body: body('The second section says another thing.') }];
    const vault = fakeVault(notes);
    await runBlockIndex(vault.ports);
    notes[0].body = body('The second section now says a different thing.');
    const result = await runBlockIndex(vault.ports);
    expect(result.embedded).toBe(1);
    expect(vault.calls[1]).toHaveLength(1);
    expect(vault.calls[1][0]).toContain('a different thing');
    expect(vault.stored.get('n1')!.rows.every((row) => row.has)).toBe(true);
  });

  it('stops without storing when embedding fails', async () => {
    const vault = fakeVault([{ id: 'n1', userId: 'u1', path: 'A.md', body: body('Words enough to be a passage here.') }]);
    vault.ports.embed = async () => ({ ok: false, reason: 'no-key', detail: 'none', tokens: 0 });
    const result = await runBlockIndex(vault.ports);
    expect(result.stopped?.reason).toBe('no-key');
    expect(vault.stored.size).toBe(0);
  });

  it('stops at the deadline', async () => {
    const vault = fakeVault([{ id: 'n1', userId: 'u1', path: 'A.md', body: body('Words enough to be a passage here.') }]);
    const result = await runBlockIndex(vault.ports, { deadline: 0, now: () => 1 });
    expect(result.stopped?.reason).toBe('time');
  });
});

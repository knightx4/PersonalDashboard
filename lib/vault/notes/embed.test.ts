import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import { runNoteEmbed, type NoteEmbedPorts } from '@/lib/vault/notes/embed';

/**
 * The loop, not the SQL. The hash, the staleness read and the guarded write
 * are in migrations-vault/0021 and were exercised against the live vault
 * when it was applied: a stored vector took its note off the stale list, and
 * a vector sent with another hash was not written.
 */

type Note = { id: string; userId: string; text: string };
type Stored = { hash: string; model: string };

const md5 = (text: string): string => createHash('md5').update(text).digest('hex');
const vector = (): number[] => new Array(EMBEDDING_DIMENSIONS).fill(0.01);

/** A vault in memory that behaves like the two functions in 0021. */
function fakeVault(notes: Note[], options: { rewrite?: (note: Note) => void } = {}) {
  const stored = new Map<string, Stored>();
  const calls: { texts: string[] }[] = [];
  const spent: { userId: string; report: SpendReport }[] = [];

  const ports: NoteEmbedPorts = {
    async stale(limit) {
      return notes
        .filter((note) => stored.get(note.id)?.hash !== md5(note.text))
        .sort((a, b) => a.userId.localeCompare(b.userId))
        .slice(0, limit)
        .map((note) => ({ noteId: note.id, userId: note.userId, text: note.text, bodyHash: md5(note.text) }));
    },
    async store(rows) {
      let count = 0;
      for (const row of rows) {
        const note = notes.find((n) => n.id === row.noteId);
        if (!note) continue;
        options.rewrite?.(note);
        if (md5(note.text) !== row.bodyHash) continue;
        stored.set(note.id, { hash: row.bodyHash, model: row.model });
        count += 1;
      }
      return count;
    },
    async embed({ texts, onSpend }) {
      calls.push({ texts });
      onSpend({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: texts.length } });
      return { ok: true, vectors: texts.map(() => vector()), model: 'voyage-4-lite', tokens: texts.length };
    },
    async ledger(userId, report) {
      spent.push({ userId, report });
    },
  };

  return { ports, stored, calls, spent };
}

const note = (id: string, userId = 'u1'): Note => ({ id, userId, text: `Note ${id}\n\nWhat ${id} says` });

describe('runNoteEmbed', () => {
  it('embeds every note once, in chunks', async () => {
    const notes = ['a', 'b', 'c', 'd', 'e'].map((id) => note(id));
    const vault = fakeVault(notes);

    const result = await runNoteEmbed(vault.ports, { chunk: 2 });

    expect(result.embedded).toBe(5);
    expect(result.stopped).toBeNull();
    expect(vault.calls.map((call) => call.texts.length)).toEqual([2, 2, 1]);
    expect(vault.stored.size).toBe(5);
  });

  it('does not embed an unchanged note again, and does embed one that changed', async () => {
    const notes = [note('a'), note('b')];
    const vault = fakeVault(notes);
    await runNoteEmbed(vault.ports);
    vault.calls.length = 0;

    const again = await runNoteEmbed(vault.ports);
    expect(again.embedded).toBe(0);
    expect(vault.calls).toEqual([]);

    notes[1].text = 'Note b\n\nSomething new';
    const changed = await runNoteEmbed(vault.ports);
    expect(changed.embedded).toBe(1);
    expect(vault.calls).toEqual([{ texts: ['Note b\n\nSomething new'] }]);
    expect(vault.stored.get('b')?.hash).toBe(md5('Note b\n\nSomething new'));
  });

  it('never mixes two owners in one call, and charges each call to its owner', async () => {
    const vault = fakeVault([note('a', 'u1'), note('b', 'u2'), note('c', 'u1')]);

    const result = await runNoteEmbed(vault.ports);

    expect(result.embedded).toBe(3);
    expect(vault.calls.map((call) => call.texts.length)).toEqual([2, 1]);
    expect(vault.spent.map((entry) => entry.userId)).toEqual(['u1', 'u2']);
  });

  it('stops when every note in a chunk changed while it was embedded', async () => {
    const vault = fakeVault([note('a')], {
      rewrite: (n) => {
        n.text = `${n.text} and more`;
      },
    });

    const result = await runNoteEmbed(vault.ports);

    expect(result.embedded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.stopped?.reason).toBe('unchanged');
  });

  it('stops on a failed call without writing anything', async () => {
    const vault = fakeVault([note('a')]);
    vault.ports.embed = async () => ({ ok: false, reason: 'no-key', detail: 'no key', tokens: 0 });

    const result = await runNoteEmbed(vault.ports);

    expect(result.stopped?.reason).toBe('no-key');
    expect(vault.stored.size).toBe(0);
  });

  it('stops at the deadline and says so only when notes are left', async () => {
    const vault = fakeVault([note('a'), note('b')]);
    let clock = 0;
    const result = await runNoteEmbed(vault.ports, {
      chunk: 1,
      deadline: 1,
      now: () => clock++,
    });
    expect(result.embedded).toBe(1);
    expect(result.stopped?.reason).toBe('time');

    const done = fakeVault([]);
    const nothing = await runNoteEmbed(done.ports, { deadline: 0, now: () => 5 });
    expect(nothing.stopped).toBeNull();
  });
});

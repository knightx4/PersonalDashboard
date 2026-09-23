import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import { runMapEmbed, type MapEmbedPorts, type MapRowKind } from '@/lib/vault/map/embed';

vi.mock('next/server', () => ({ after: vi.fn() }));

/**
 * The loop, not the SQL. The two functions it calls were exercised against the
 * live map when migrations-vault/0006 was applied.
 */

type Row = {
  kind: MapRowKind;
  id: string;
  userId: string;
  text: string;
  embedding: number[] | null;
  model: string | null;
};

const vector = (): number[] => new Array(EMBEDDING_DIMENSIONS).fill(0.01);

function fakeMap(rows: Row[], options: { rewrite?: (row: Row) => void } = {}) {
  const calls: { texts: string[] }[] = [];
  const spent: { userId: string; report: SpendReport }[] = [];

  const ports: MapEmbedPorts = {
    async unembedded(kind, limit) {
      return rows
        .filter((row) => row.kind === kind && row.embedding === null)
        .sort((a, b) => a.userId.localeCompare(b.userId))
        .slice(0, limit)
        .map(({ id, userId, text }) => ({ id, userId, text }));
    },
    async store(kind, written) {
      let count = 0;
      for (const one of written) {
        const row = rows.find((r) => r.kind === kind && r.id === one.id);
        if (!row) continue;
        options.rewrite?.(row);
        if (row.text !== one.text) continue;
        row.embedding = one.vector;
        row.model = one.model;
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

  return { ports, calls, spent };
}

const theme = (id: string, userId = 'u1'): Row => ({
  kind: 'theme',
  id,
  userId,
  text: `Theme ${id}\n\nWhat ${id} is about`,
  embedding: null,
  model: null,
});

const position = (id: string, userId = 'u1'): Row => ({
  kind: 'position',
  id,
  userId,
  text: `Position ${id} says something`,
  embedding: null,
  model: null,
});

describe('runMapEmbed', () => {
  it('gives every theme and position a vector and names the model', async () => {
    const rows = [theme('t1'), theme('t2'), theme('t3'), position('p1'), position('p2')];
    const { ports, calls } = fakeMap(rows);

    const result = await runMapEmbed(ports, { chunk: 2 });

    expect(result).toMatchObject({ themes: 3, positions: 2, skipped: 0, stopped: null });
    expect(rows.every((row) => row.embedding !== null && row.model === 'voyage-4-lite')).toBe(true);
    // Themes first, in chunks of two.
    expect(calls.map((call) => call.texts.length)).toEqual([2, 1, 2]);
  });

  it('bills each call to the account whose rows it embedded', async () => {
    const rows = [theme('a', 'u1'), theme('b', 'u2'), theme('c', 'u2')];
    const { ports, calls, spent } = fakeMap(rows);

    const result = await runMapEmbed(ports, { chunk: 10 });

    expect(result.themes).toBe(3);
    // One read held both accounts; each call went out with one account's rows.
    expect(calls.map((call) => call.texts.length)).toEqual([1, 2]);
    expect(spent.map((s) => s.userId)).toEqual(['u1', 'u2']);
  });

  it('does nothing and calls nobody when every row already has a vector', async () => {
    const rows = [{ ...theme('t1'), embedding: vector(), model: 'voyage-4-lite' }];
    const { ports, calls } = fakeMap(rows);

    const result = await runMapEmbed(ports);

    expect(result).toMatchObject({ themes: 0, positions: 0, calls: 0, stopped: null });
    expect(calls).toEqual([]);
  });

  it('stops at the deadline with the rest left for the next run', async () => {
    const rows = [theme('t1'), theme('t2'), position('p1')];
    const { ports } = fakeMap(rows);
    let clock = 0;

    const first = await runMapEmbed(ports, {
      chunk: 1,
      deadline: 1,
      now: () => clock++,
    });
    expect(first.themes).toBe(1);
    expect(first.stopped?.reason).toBe('time');

    const second = await runMapEmbed(ports, { chunk: 1 });
    expect(second).toMatchObject({ themes: 1, positions: 1, stopped: null });
    expect(rows.every((row) => row.embedding !== null)).toBe(true);
  });

  it('does not write a vector for a row whose text changed, and stops rather than spin', async () => {
    const rows = [theme('t1')];
    const { ports } = fakeMap(rows, {
      rewrite: (row) => {
        row.text = `${row.text} (renamed)`;
      },
    });

    const result = await runMapEmbed(ports);

    expect(result).toMatchObject({ themes: 0, skipped: 1 });
    expect(result.stopped?.reason).toBe('unchanged');
    expect(rows[0].embedding).toBeNull();
  });

  it('stops on a failed call with what came before it written, and still records the spend', async () => {
    const rows = [theme('t1'), theme('t2')];
    const { ports, spent } = fakeMap(rows);
    const embed = ports.embed;
    let n = 0;
    ports.embed = async (input) => {
      n += 1;
      if (n === 1) return embed(input);
      input.onSpend({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 3 } });
      return { ok: false, reason: 'malformed', detail: 'bad body', tokens: 3 };
    };

    const result = await runMapEmbed(ports, { chunk: 1 });

    expect(result.themes).toBe(1);
    expect(result.stopped).toEqual({ reason: 'malformed', detail: 'bad body' });
    expect(rows[0].embedding).not.toBeNull();
    expect(rows[1].embedding).toBeNull();
    expect(spent).toHaveLength(2);
  });
});

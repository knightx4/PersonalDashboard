import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import type { EmbedOutcome } from '@/lib/learn/embed/embed';
import { runMemorySweep, type ChunkWrite, type MemorySweepPorts, type StaleSource } from './sweep';

const row = (ref: string, text: string, userId = 'user-a', dash: string | null = null): StaleSource => ({
  userId,
  sourceTable: 'obsidian.notes',
  sourceRef: ref,
  title: ref,
  mine: text,
  dash,
  sourceHash: `hash-${ref}-${text.length}`,
});

/** A store that behaves like the SQL: a row is stale until all its passages are written. */
function fakePorts(rows: StaleSource[], options: { failEmbed?: boolean } = {}) {
  const written = new Map<string, ChunkWrite['chunks'][number][]>();
  const expected = new Map<string, number>();
  const calls: ChunkWrite[][] = [];
  const spend: { userId: string; report: SpendReport }[] = [];
  const embedCalls: string[][] = [];
  let live = [...rows];

  const ports: MemorySweepPorts = {
    async prune() {
      let removed = 0;
      for (const key of [...written.keys()]) {
        if (!live.some((r) => r.sourceRef === key)) {
          removed += written.get(key)!.length;
          written.delete(key);
        }
      }
      return removed;
    },
    async stale(limit) {
      return live
        .filter((r) => (written.get(r.sourceRef)?.length ?? 0) !== expected.get(r.sourceRef + r.sourceHash))
        .slice(0, limit);
    },
    async store(batch) {
      calls.push(batch);
      let n = 0;
      for (const w of batch) {
        const have = w.replace ? [] : (written.get(w.sourceRef) ?? []);
        written.set(w.sourceRef, [...have, ...w.chunks].filter((c) => c.chunkIndex < w.chunkCount));
        expected.set(w.sourceRef + w.sourceHash, w.chunkCount);
        n += w.chunks.length;
      }
      return n;
    },
    async embed({ texts, model, onSpend }): Promise<EmbedOutcome> {
      embedCalls.push(texts);
      onSpend({ model, usage: { ...EMPTY_USAGE, inputTokens: texts.length * 10 } });
      if (options.failEmbed) return { ok: false, reason: 'no-key', detail: 'no key', tokens: 0 };
      return { ok: true, vectors: texts.map(() => [0.1]), model, tokens: texts.length * 10 };
    },
    async ledger(userId, report) {
      spend.push({ userId, report });
    },
  };
  return {
    ports,
    written,
    calls,
    spend,
    embedCalls,
    setLive: (next: StaleSource[]) => (live = next),
  };
}

const long = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i}. `.repeat(60)).join('\n\n');

describe('runMemorySweep', () => {
  it('copies the specs before reading anything, and carries on when the copy fails', async () => {
    const order: string[] = [];
    const fake = fakePorts([row('a.md', 'One.')]);
    const prune = fake.ports.prune;
    const ports: MemorySweepPorts = {
      ...fake.ports,
      documents: async () => {
        order.push('documents');
        return 3;
      },
      prune: async () => {
        order.push('prune');
        return prune();
      },
    };
    const result = await runMemorySweep(ports);
    expect(order).toEqual(['documents', 'prune']);
    expect(result.documents).toBe(3);

    const failing = fakePorts([row('b.md', 'Two.')]);
    const quiet = console.error;
    console.error = () => {};
    try {
      const after = await runMemorySweep({
        ...failing.ports,
        documents: async () => {
          throw new Error('docs/ is missing');
        },
      });
      expect(after.documents).toBeNull();
      expect(after.rows).toBe(1);
    } finally {
      console.error = quiet;
    }
  });

  it('embeds every stale row and then finds nothing left', async () => {
    const fake = fakePorts([row('a.md', 'One.'), row('b.md', 'Two.'), row('c.md', long(4))]);
    const result = await runMemorySweep(fake.ports);
    expect(result.stopped).toBeNull();
    expect(result.rows).toBe(3);
    expect(fake.written.get('a.md')!.map((c) => c.body)).toEqual(['a.md\n\nOne.']);
    expect(fake.written.get('c.md')!.length).toBeGreaterThan(1);

    const again = await runMemorySweep(fake.ports);
    expect(again.rows).toBe(0);
    expect(fake.embedCalls).toHaveLength(1);
  });

  it('replaces an edited row\'s passages and removes a deleted row\'s', async () => {
    const fake = fakePorts([row('a.md', long(4)), row('b.md', 'Two.')]);
    await runMemorySweep(fake.ports);
    expect(fake.written.get('a.md')!.length).toBeGreaterThan(1);

    fake.setLive([row('a.md', 'Now short.')]);
    const result = await runMemorySweep(fake.ports);
    expect(result.pruned).toBe(1);
    expect(fake.written.has('b.md')).toBe(false);
    expect(fake.written.get('a.md')!.map((c) => c.body)).toEqual(['a.md\n\nNow short.']);
  });

  it('records spend against the owner of each round, never mixing two', async () => {
    const fake = fakePorts([row('a.md', 'A.', 'user-a'), row('b.md', 'B.', 'user-b')]);
    await runMemorySweep(fake.ports);
    expect(fake.embedCalls).toEqual([['a.md\n\nA.'], ['b.md\n\nB.']]);
    expect(fake.spend.map((s) => s.userId)).toEqual(['user-a', 'user-b']);
  });

  it('labels Dash\'s passages as Dash\'s', async () => {
    const fake = fakePorts([row('goal', 'Mine.', 'user-a', 'Dash found this.')]);
    await runMemorySweep(fake.ports);
    expect(fake.written.get('goal')!.map((c) => c.author)).toEqual(['me', 'dash']);
  });

  it('writes a long row over several calls, the first replacing', async () => {
    const fake = fakePorts([row('big.md', long(20))]);
    await runMemorySweep(fake.ports, { write: 3 });
    const writes = fake.calls.flat();
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.map((w) => w.replace)).toEqual([true, ...writes.slice(1).map(() => false)]);
    const total = writes[0].chunkCount;
    expect(fake.written.get('big.md')!.map((c) => c.chunkIndex)).toEqual([...Array(total).keys()]);
  });

  it('stops on an embedding failure without writing, and says why', async () => {
    const fake = fakePorts([row('a.md', 'One.')], { failEmbed: true });
    const result = await runMemorySweep(fake.ports);
    expect(result.stopped?.reason).toBe('no-key');
    expect(fake.calls).toEqual([]);
  });

  it('starts nothing after the deadline and reports rows left', async () => {
    const fake = fakePorts([row('a.md', 'One.')]);
    const result = await runMemorySweep(fake.ports, { deadline: 0, now: () => 1 });
    expect(result.stopped?.reason).toBe('time');
    expect(fake.embedCalls).toEqual([]);
  });
});

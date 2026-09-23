import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  runEmbedSweep,
  vectorLiteral,
  type EmbedCall,
  type SegmentStore,
} from '@/lib/learn/catalogue/embed-sweep';

/**
 * The loop, not the SQL.
 *
 * Both statements the sweep runs were exercised against the live catalogue
 * when this was built; what is worth holding still in a test is the behaviour
 * the done-when names -- that a run leaves nothing unembedded, that each
 * segment says which model embedded it, and that stopping halfway and running
 * again finishes without redoing what was done.
 */

const vector = (seed: number): number[] => new Array(EMBEDDING_DIMENSIONS).fill(seed / 1000);

type Row = { id: string; text: string; embedding: number[] | null; model: string | null };

/** A catalogue in memory, with the text guard the real statement has. */
function fakeStore(rows: Row[]): SegmentStore & { rows: Row[]; reads: number[] } {
  const reads: number[] = [];
  return {
    rows,
    reads,
    async unembedded(limit) {
      reads.push(limit);
      return rows
        .filter((row) => row.embedding === null)
        .slice(0, limit)
        .map(({ id, text }) => ({ id, text }));
    },
    async store(written) {
      let count = 0;
      for (const one of written) {
        const row = rows.find((candidate) => candidate.id === one.id);
        if (!row || row.text !== one.text) continue;
        row.embedding = one.vector;
        row.model = one.model;
        count += 1;
      }
      return count;
    },
  };
}

function segments(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    text: `section ${index}`,
    embedding: null,
    model: null,
  }));
}

/** An embedder that answers every text, and remembers what it was asked. */
function fakeEmbed(model = 'voyage-4-lite'): EmbedCall & { batches: string[][] } {
  const batches: string[][] = [];
  const call: EmbedCall = async ({ texts, onSpend }) => {
    batches.push(texts);
    onSpend({
      model,
      usage: { inputTokens: texts.length * 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    });
    return { ok: true, vectors: texts.map((_, index) => vector(index)), model, tokens: texts.length * 10 };
  };
  return Object.assign(call, { batches });
}

describe('vectorLiteral', () => {
  it('writes the form postgres parses', () => {
    const literal = vectorLiteral(vector(1));
    expect(literal.startsWith('[0.001,0.001')).toBe(true);
    expect(literal.endsWith(']')).toBe(true);
  });

  it('refuses a vector of the wrong width', () => {
    expect(() => vectorLiteral([1, 2, 3])).toThrow(/1024 dimensions/);
  });
});

describe('runEmbedSweep', () => {
  it('leaves nothing unembedded, each row naming its model', async () => {
    const store = fakeStore(segments(10));
    const embed = fakeEmbed();

    const result = await runEmbedSweep({ store, embed }, { chunk: 4 });

    expect(result.embedded).toBe(10);
    expect(result.skipped).toBe(0);
    expect(store.rows.every((row) => row.embedding !== null)).toBe(true);
    expect(store.rows.every((row) => row.model === 'voyage-4-lite')).toBe(true);
    expect(result.model).toBe('voyage-4-lite');
    expect(embed.batches.map((batch) => batch.length)).toEqual([4, 4, 2]);
  });

  it('embeds each segment for its own text', async () => {
    const store = fakeStore(segments(3));
    const embed = fakeEmbed();

    await runEmbedSweep({ store, embed }, { chunk: 3 });

    expect(embed.batches[0]).toEqual(['section 0', 'section 1', 'section 2']);
    expect(store.rows[1].embedding).toEqual(vector(1));
  });

  it('does nothing when every segment already has one', async () => {
    const store = fakeStore(segments(3).map((row) => ({ ...row, embedding: vector(0), model: 'voyage-4-lite' })));
    const embed = fakeEmbed();

    const result = await runEmbedSweep({ store, embed });

    expect(embed.batches).toEqual([]);
    expect(result.embedded).toBe(0);
    expect(result.tokens).toBe(0);
  });

  it('resumes where a stopped run left off, without redoing it', async () => {
    const store = fakeStore(segments(6));
    const failing: EmbedCall = async ({ texts, onSpend }) => {
      if (store.rows.filter((row) => row.embedding !== null).length >= 2) {
        return { ok: false, reason: 'timeout', detail: 'the provider stopped answering', tokens: 0 };
      }
      return fakeEmbed()({ texts, model: 'voyage-4-lite', onSpend });
    };

    const first = await runEmbedSweep({ store, embed: failing }, { chunk: 2 });
    expect(first.embedded).toBe(2);
    expect(first.stopped).toEqual({ reason: 'timeout', detail: 'the provider stopped answering' });

    const embed = fakeEmbed();
    const second = await runEmbedSweep({ store, embed }, { chunk: 2 });

    expect(second.embedded).toBe(4);
    expect(embed.batches.flat()).toEqual(['section 2', 'section 3', 'section 4', 'section 5']);
    expect(store.rows.every((row) => row.embedding !== null)).toBe(true);
  });

  it('stops at the deadline and leaves the rest for the next press', async () => {
    const store = fakeStore(segments(10));
    const embed = fakeEmbed();
    let clock = 0;

    const first = await runEmbedSweep(
      {
        store,
        embed: async (input) => {
          clock += 100;
          return embed(input);
        },
      },
      { chunk: 4, deadline: 150, now: () => clock },
    );

    expect(first.embedded).toBe(8);
    expect(first.stopped?.reason).toBe('time');

    const second = await runEmbedSweep({ store, embed }, { chunk: 4 });
    expect(second.embedded).toBe(2);
    expect(second.stopped).toBeNull();
  });

  it('ends clean past the deadline when nothing is left', async () => {
    const store = fakeStore(segments(0));
    const result = await runEmbedSweep(
      { store, embed: fakeEmbed() },
      { deadline: 0, now: () => 1 },
    );
    expect(result.stopped).toBeNull();
  });

  it('keeps what it wrote before a failure', async () => {
    const store = fakeStore(segments(4));
    const embed: EmbedCall = async ({ texts, onSpend }) =>
      texts.includes('section 2')
        ? { ok: false, reason: 'refused', detail: 'bad key', tokens: 0 }
        : fakeEmbed()({ texts, model: 'voyage-4-lite', onSpend });

    const result = await runEmbedSweep({ store, embed }, { chunk: 2 });

    expect(result.embedded).toBe(2);
    expect(result.stopped?.reason).toBe('refused');
    expect(store.rows.map((row) => row.embedding !== null)).toEqual([true, true, false, false]);
  });

  it('leaves a segment whose text changed under it for the next run', async () => {
    const store = fakeStore(segments(2));
    let rewritten = false;
    const embed: EmbedCall = async ({ texts, onSpend }) => {
      const answer = await fakeEmbed()({ texts, model: 'voyage-4-lite', onSpend });
      if (!rewritten) {
        // A re-sweep of the article lands between the read and the write.
        store.rows[1].text = 'section 1, rewritten';
        rewritten = true;
      }
      return answer;
    };

    const result = await runEmbedSweep({ store, embed }, { chunk: 2 });

    // The second pass reads the new text and embeds that, so the run still
    // ends with nothing unembedded -- one segment just cost two calls.
    expect(result.skipped).toBe(1);
    expect(result.embedded).toBe(2);
    expect(store.rows[1].embedding).not.toBeNull();
    expect(store.rows[1].text).toBe('section 1, rewritten');
  });

  it('stops rather than spinning when a chunk writes nothing', async () => {
    const store = fakeStore(segments(2));
    let calls = 0;
    const embed: EmbedCall = async ({ texts, onSpend }) => {
      const answer = await fakeEmbed()({ texts, model: 'voyage-4-lite', onSpend });
      calls += 1;
      for (const row of store.rows) row.text = `${row.text} (${calls})`;
      return answer;
    };

    const result = await runEmbedSweep({ store, embed }, { chunk: 2 });

    expect(calls).toBe(1);
    expect(result.embedded).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.stopped?.reason).toBe('unchanged');
  });

  it('refuses vectors that do not line up with the segments', async () => {
    const store = fakeStore(segments(3));
    const embed: EmbedCall = async ({ texts }) => ({
      ok: true,
      vectors: texts.slice(1).map((_, index) => vector(index)),
      model: 'voyage-4-lite',
      tokens: 5,
    });

    const result = await runEmbedSweep({ store, embed }, { chunk: 3 });

    expect(result.embedded).toBe(0);
    expect(result.stopped?.reason).toBe('malformed');
    expect(store.rows.every((row) => row.embedding === null)).toBe(true);
  });

  it('bills every call to the account running it', async () => {
    const store = fakeStore(segments(5));
    const billed: SpendReport[] = [];

    const result = await runEmbedSweep(
      {
        store,
        embed: fakeEmbed(),
        ledger: async (report) => {
          billed.push(report);
        },
      },
      { chunk: 2 },
    );

    expect(billed.map((report) => report.model)).toEqual(['voyage-4-lite', 'voyage-4-lite', 'voyage-4-lite']);
    expect(billed.map((report) => report.usage.inputTokens)).toEqual([20, 20, 10]);
    expect(result.calls).toBe(3);
    expect(result.tokens).toBe(50);
  });

  it('bills what a failed call cost before giving up', async () => {
    const store = fakeStore(segments(2));
    const billed: SpendReport[] = [];
    const embed: EmbedCall = async ({ onSpend }) => {
      onSpend({
        model: 'voyage-4-lite',
        usage: { inputTokens: 40, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      });
      return { ok: false, reason: 'malformed', detail: 'no vectors in the response', tokens: 40 };
    };

    const result = await runEmbedSweep({ store, embed, ledger: async (report) => void billed.push(report) }, {});

    expect(billed).toHaveLength(1);
    expect(result.tokens).toBe(40);
    expect(result.embedded).toBe(0);
  });

  it('stops at the limit it was given', async () => {
    const store = fakeStore(segments(20));
    const embed = fakeEmbed();

    const result = await runEmbedSweep({ store, embed }, { chunk: 4, limit: 6 });

    expect(result.embedded).toBe(6);
    expect(embed.batches.map((batch) => batch.length)).toEqual([4, 2]);
    expect(store.rows.filter((row) => row.embedding === null)).toHaveLength(14);
  });

  it('reads no more than one chunk at a time', async () => {
    const store = fakeStore(segments(9));

    await runEmbedSweep({ store, embed: fakeEmbed() }, { chunk: 5 });

    expect(store.reads).toEqual([5, 5, 5]);
  });
});

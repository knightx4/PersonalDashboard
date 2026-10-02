import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingClient } from '@/lib/learn/embed/voyage';
import {
  mergeNewTakeaways,
  readJudgement,
  type CoverRow,
  type FreshTakeaway,
  type KnownTakeaway,
  type MergeStore,
} from './merge';

const USER = 'user-1';

type Row = FreshTakeaway & { status: string; vector: number[] | null; coveredBy: string | null };

/** The takeaways, their videos and what covers them, in memory. */
function memoryStore(rows: Row[], cover: CoverRow[] = []) {
  const store: MergeStore = {
    async fresh() {
      return rows.filter((row) => row.vector === null && row.status === 'open').map(({ id, title, body, module, videoIds }) => ({ id, title, body, module, videoIds: [...videoIds] }));
    },
    async known() {
      return rows
        .filter((row) => row.vector !== null)
        .map((row) => ({ id: row.id, title: row.title, body: row.body, module: row.module, videoIds: [...row.videoIds], status: row.status, vector: row.vector! }) as KnownTakeaway);
    },
    async coverRows() {
      return cover;
    },
    async saveVector(_userId, id, vector) {
      rows.find((row) => row.id === id)!.vector = vector;
    },
    async mergeInto(_userId, fromId, intoId, wording) {
      const from = rows.find((row) => row.id === fromId)!;
      const into = rows.find((row) => row.id === intoId)!;
      into.videoIds.push(...from.videoIds.filter((id) => !into.videoIds.includes(id)));
      rows.splice(rows.indexOf(from), 1);
      if (wording) Object.assign(into, { title: wording.title, body: wording.body, module: wording.module, vector: wording.vector });
    },
    async markCovered(_userId, id, by) {
      const row = rows.find((one) => one.id === id)!;
      row.status = 'covered';
      row.coveredBy = by.kind === 'plan' ? `#${by.number}` : `idea ${by.id}`;
    },
  };
  return { store, rows };
}

const row = (id: string, title: string, videoIds: string[], vector: number[] | null = null): Row => ({
  id,
  title,
  body: `${title}, in this app.`,
  module: 'dev',
  videoIds,
  status: 'open',
  vector,
  coveredBy: null,
});

/** Vectors by the first word of the text, so each test says which ideas sit near each other. */
function embedBy(vectors: Record<string, number[]>): EmbeddingClient {
  return async (request) => ({
    ok: true,
    vectors: request.texts.map((text) => vectors[text.split(/\s/)[0]] ?? [0, 0, 1]),
    model: 'voyage-4-lite',
    tokens: request.texts.length * 10,
  });
}

function stubJudge(replies: unknown[]) {
  const create = vi.fn();
  for (const input of replies) {
    create.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'report_match', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 300, output_tokens: 20 },
    });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('mergeNewTakeaways', () => {
  it('merges two videos that make the same point in different words into one takeaway with both videos', async () => {
    const { store, rows } = memoryStore([
      row('a', 'Specs before code: write what done means first', ['v1'], [1, 0, 0]),
      row('b', 'Acceptance criteria before the agent starts', ['v2']),
    ]);
    const { client, create } = stubJudge([{ same_as: 'T1', clearer: 'new', covered_by: 'none' }]);
    const onSpend = vi.fn();

    const result = await mergeNewTakeaways(store, USER, {
      anthropicApiKey: 'k',
      client,
      embed: embedBy({ Acceptance: [0.9, 0.2, 0] }),
      onSpend,
    });

    expect(result).toEqual({ seen: 1, merged: 1, covered: 0, stopped: null });
    expect(rows.map((one) => [one.id, one.title, one.videoIds])).toEqual([
      ['a', 'Acceptance criteria before the agent starts', ['v1', 'v2']],
    ]);
    expect(create.mock.calls[0][0].messages[0].content).toContain('T1: Specs before code');
    expect(onSpend.mock.calls.map((call) => call[1])).toEqual(['embed-inspiration-takeaways', 'merge-inspiration-takeaways']);
  });

  it('keeps two near takeaways apart when the pass says they are different ideas, and keeps the earlier wording', async () => {
    const { store, rows } = memoryStore([
      row('a', 'Log every decision the agent makes', ['v1'], [1, 0, 0]),
      row('b', 'Review each decision before it ships', ['v2']),
    ]);
    const { client } = stubJudge([{ same_as: 'none', clearer: 'earlier', covered_by: 'none' }]);

    const result = await mergeNewTakeaways(store, USER, { anthropicApiKey: 'k', client, embed: embedBy({ Review: [0.8, 0.6, 0] }) });

    expect(result).toEqual({ seen: 1, merged: 0, covered: 0, stopped: null });
    expect(rows.map((one) => [one.id, one.videoIds, one.vector !== null])).toEqual([
      ['a', ['v1'], true],
      ['b', ['v2'], true],
    ]);
  });

  it('does not ask about a takeaway with nothing near it', async () => {
    const { store, rows } = memoryStore([row('a', 'Log decisions', ['v1'], [1, 0, 0]), row('b', 'Dark mode', ['v2'])]);
    const { client, create } = stubJudge([]);

    await mergeNewTakeaways(store, USER, { anthropicApiKey: 'k', client, embed: embedBy({ Dark: [0, 1, 0] }) });

    expect(create).not.toHaveBeenCalled();
    expect(rows.find((one) => one.id === 'b')!.vector).toEqual([0, 1, 0]);
  });

  it('never offers a takeaway from the same video as the one it might repeat', async () => {
    const { store } = memoryStore([row('a', 'Log decisions', ['v1'], [1, 0, 0]), row('b', 'Write decisions down', ['v1'])]);
    const { client, create } = stubJudge([]);
    await mergeNewTakeaways(store, USER, { anthropicApiKey: 'k', client, embed: embedBy({ Write: [1, 0, 0] }) });
    expect(create).not.toHaveBeenCalled();
  });

  it('merges two new takeaways from one run into each other', async () => {
    const { store, rows } = memoryStore([row('a', 'Log decisions', ['v1']), row('b', 'Keep a decision log', ['v2'])]);
    const { client } = stubJudge([{ same_as: 'T1', clearer: 'earlier', covered_by: 'none' }]);

    const result = await mergeNewTakeaways(store, USER, {
      anthropicApiKey: 'k',
      client,
      embed: embedBy({ Log: [1, 0, 0], Keep: [0.95, 0.1, 0] }),
    });

    expect(result.merged).toBe(1);
    expect(rows.map((one) => [one.title, one.videoIds])).toEqual([['Log decisions', ['v1', 'v2']]]);
  });

  it('names the plan feature that already covers a takeaway', async () => {
    const { store, rows } = memoryStore(
      [row('a', 'Dark mode for every page', ['v1'])],
      [
        { kind: 'plan', id: 'p12', number: 12, text: 'Dark mode\n\nEvery page follows the system theme.' },
        { kind: 'idea', id: 'i1', text: 'Sort the ideas page by score' },
      ],
    );
    const { client, create } = stubJudge([{ same_as: 'none', clearer: 'earlier', covered_by: 'C1' }]);

    const result = await mergeNewTakeaways(store, USER, {
      anthropicApiKey: 'k',
      client,
      embed: embedBy({ Dark: [0, 1, 0], Sort: [1, 0, 0] }),
    });

    expect(result.covered).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'covered', coveredBy: '#12' });
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('C1: Plan feature #12: Dark mode');
    expect(prompt).not.toContain('Sort the ideas page');
  });

  it('leaves everything as it was when embedding fails, for the next run', async () => {
    const { store, rows } = memoryStore([row('a', 'Log decisions', ['v1'])]);
    const { client, create } = stubJudge([]);
    const refuse: EmbeddingClient = async () => ({ ok: false, reason: 'refused', detail: '401', tokens: 0, retryAfterMs: null });

    const result = await mergeNewTakeaways(store, USER, { anthropicApiKey: 'k', client, embed: refuse });

    expect(result.stopped).toMatch(/embedding the takeaways failed/);
    expect(rows[0].vector).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('stops without storing the vector when the pass fails, so the takeaway is tried again', async () => {
    const { store, rows } = memoryStore([row('a', 'Log decisions', ['v1'], [1, 0, 0]), row('b', 'Keep a log', ['v2'])]);
    const create = vi.fn().mockRejectedValue(new Error('overloaded'));
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await mergeNewTakeaways(store, USER, { anthropicApiKey: 'k', client, embed: embedBy({ Keep: [1, 0, 0] }) });

    expect(result.stopped).toMatch(/overloaded/);
    expect(rows.find((one) => one.id === 'b')!.vector).toBeNull();
  });
});

describe('readJudgement', () => {
  it('reads labels into indexes and treats anything out of range as none', () => {
    expect(readJudgement({ same_as: 'T2', clearer: 'new', covered_by: 'c1' }, 2, 1)).toEqual({
      sameAs: 1,
      newIsClearer: true,
      coveredBy: 0,
    });
    expect(readJudgement({ same_as: 'T3', clearer: 'maybe', covered_by: 'C9' }, 2, 1)).toEqual({
      sameAs: null,
      newIsClearer: false,
      coveredBy: null,
    });
    expect(readJudgement('nonsense', 2, 1)).toEqual({ sameAs: null, newIsClearer: false, coveredBy: null });
  });
});

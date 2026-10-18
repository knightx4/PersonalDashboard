import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { backfillFigureNeeds, backfillKindLines, backfillPrompt, dueNeeds, writeBackfillBlock, type NeedRow } from './backfill';
import { tableKind } from './kinds/table';
import type { FigureResolveContext } from './types';

type Call = { table: string; op: string; args: unknown[] };

/** A query that records what it was asked and resolves to the table's scripted rows. */
function fakeDb(tables: Record<string, unknown[]>, calls: Call[]) {
  const from = (table: string) => {
    let op = 'select';
    let payload: unknown;
    const query: Record<string, unknown> = {};
    const settle = () => {
      if (op !== 'select') calls.push({ table, op, args: [payload] });
      return { data: tables[table] ?? [], error: null };
    };
    for (const method of ['select', 'is', 'in', 'eq']) query[method] = () => query;
    query.update = (value: unknown) => ((op = 'update'), (payload = value), query);
    query.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
    query.then = (resolve: (v: unknown) => unknown) => resolve(settle());
    return query;
  };
  return { from } as never;
}

const need = (over: Partial<NeedRow> = {}): NeedRow => ({
  id: 'n1',
  user_id: 'u1',
  card_id: 'c1',
  ordinal: 0,
  need: 'figure_kind',
  shows: 'Two prices side by side.',
  why: 'Numbers compare faster in a grid.',
  caption: 'Two prices.',
  key: 'k1',
  tried_at: null,
  ...over,
});

const wantedBlock = { kind: 'wanted', caption: 'Two prices.', spec: { need: 'figure_kind', shows: 'x', why: 'y' } };
const card = (figures: unknown[]) => ({ id: 'c1', idea_name: 'Prices', hook: null, summary: 'Prices differ.', takeaway: null, example: null, figures });

const context = {} as FigureResolveContext;
const reply = (input: Record<string, unknown>) =>
  ({
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', name: 'report_figure', input }], usage: { input_tokens: 1, output_tokens: 1 } }),
    },
  }) as never;

const tableReport = {
  can_draw: true,
  reason: null,
  kind: 'table',
  caption: 'Two prices.',
  spec: tableKind.example.spec,
};

function ports(cardFigures: unknown[]) {
  const learnCalls: Call[] = [];
  const learn = fakeDb(
    {
      figure_need_steps: [{ user_id: 'u1', key: 'k1', plan_item_id: 'p1' }],
      figure_needs: [need()],
      feed_cards: [card(cardFigures)],
    },
    learnCalls,
  ) as unknown as LearnSupabaseClient;
  const plan = fakeDb({ plan_items: [{ id: 'p1' }] }, []);
  return { learn, plan, learnCalls };
}

describe('which needs are tried (plan #2321.11)', () => {
  const now = new Date('2026-10-18T00:00:00Z');

  it('skips a need tried within the retry window and takes the longest untried first', () => {
    const rows = [need({ id: 'a', tried_at: '2026-10-17T00:00:00Z' }), need({ id: 'b', tried_at: '2026-10-10T00:00:00Z' }), need({ id: 'c' })];
    expect(dueNeeds(rows, now).map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('stops at the cap', () => {
    expect(dueNeeds([need({ id: 'a' }), need({ id: 'b' })], now, 1)).toHaveLength(1);
  });
});

describe('the prompt', () => {
  it('offers every kind but wanted and carries the lesson and the ask', () => {
    expect(backfillKindLines()).toContain('table:');
    expect(backfillKindLines()).not.toContain('wanted:');
    const prompt = backfillPrompt(
      { name: 'Prices', hook: null, summary: 'Prices differ.', takeaway: null, example: null },
      { need: 'figure_kind', shows: 'Two prices side by side.', why: 'Grid.', caption: 'Two prices.' },
    );
    expect(prompt).toContain('Lesson: Prices');
    expect(prompt).toContain('It would show: Two prices side by side.');
  });
});

describe('writing one block', () => {
  const lesson = { name: 'Prices', hook: null, summary: null, takeaway: null, example: null };
  const wanted = { need: 'figure_kind', shows: 'x', why: 'y', caption: 'Two prices.' };

  it('reads a figure through the registry', async () => {
    const got = await writeBackfillBlock({ client: reply(tableReport), lesson, wanted });
    expect(got.ok && got.block.kind).toBe('table');
  });

  it('keeps the writer’s reason when it cannot draw', async () => {
    const got = await writeBackfillBlock({ client: reply({ can_draw: false, reason: 'No such series.' }), lesson, wanted });
    expect(got).toEqual({ ok: false, reason: 'No such series.' });
  });

  it('refuses a spec its kind does not parse, and a wanted block', async () => {
    expect((await writeBackfillBlock({ client: reply({ ...tableReport, spec: {} }), lesson, wanted })).ok).toBe(false);
    expect((await writeBackfillBlock({ client: reply({ ...tableReport, kind: 'wanted' }), lesson, wanted })).ok).toBe(false);
  });
});

describe('backfilling the lessons that asked', () => {
  it('replaces the wanted block and marks the need served with the kind', async () => {
    const { learn, plan, learnCalls } = ports([wantedBlock]);
    const result = await backfillFigureNeeds({ learn, plan: plan as never, client: reply(tableReport), context });
    expect(result.served).toEqual([{ needId: 'n1', cardId: 'c1', kind: 'table' }]);
    const cardUpdate = learnCalls.find((c) => c.table === 'feed_cards')?.args[0] as { figures: { kind: string }[] };
    expect(cardUpdate.figures.map((f) => f.kind)).toEqual(['table']);
    const needUpdate = learnCalls.find((c) => c.table === 'figure_needs')?.args[0] as Record<string, unknown>;
    expect(needUpdate.served_kind).toBe('table');
    expect(needUpdate.served_at).toBeTruthy();
  });

  it('keeps the wanted block and records why when the writer cannot fill it', async () => {
    const { learn, plan, learnCalls } = ports([wantedBlock]);
    const result = await backfillFigureNeeds({ learn, plan: plan as never, client: reply({ can_draw: false, reason: 'The data is not in the source.' }), context });
    expect(result.kept).toEqual([{ needId: 'n1', reason: 'The data is not in the source.' }]);
    expect(learnCalls.some((c) => c.table === 'feed_cards')).toBe(false);
    expect((learnCalls[0].args[0] as Record<string, unknown>).unserved_reason).toBe('The data is not in the source.');
  });

  it('marks a need served without a call when the block is already replaced', async () => {
    const { learn, plan, learnCalls } = ports([{ kind: 'table', caption: 'Two prices.', spec: tableKind.example.spec }]);
    const client = { messages: { create: async () => Promise.reject(new Error('should not be called')) } } as never;
    const result = await backfillFigureNeeds({ learn, plan: plan as never, client, context });
    expect(result.served[0].kind).toBe('table');
    expect(learnCalls.some((c) => c.table === 'feed_cards')).toBe(false);
  });

  it('writes nothing when no step is done', async () => {
    const learnCalls: Call[] = [];
    const learn = fakeDb({ figure_need_steps: [{ user_id: 'u1', key: 'k1', plan_item_id: 'p1' }] }, learnCalls) as unknown as LearnSupabaseClient;
    const result = await backfillFigureNeeds({ learn, plan: fakeDb({ plan_items: [] }, []) as never, client: reply(tableReport), context });
    expect(result.considered).toBe(0);
    expect(learnCalls).toEqual([]);
  });
});

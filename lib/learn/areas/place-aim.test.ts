import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordLearnSpend = vi.fn(async () => {});
vi.mock('@/lib/learn/spend', () => ({
  collectSpend: () => {
    const reports: unknown[] = [];
    return { sink: (report: unknown) => reports.push(report), reports };
  },
  recordLearnSpend: (...args: unknown[]) => (recordLearnSpend as (...a: unknown[]) => Promise<void>)(...args),
}));

import { placeAims, type AimToPlace } from './place-aim';

/**
 * Placing goals (plan #898), with the model and the database stubbed. The
 * model's reply is read by `readPlacements`, tested in place.test.ts; what is
 * checked here is what is sent, what is written back, and that a failure is
 * reported rather than thrown.
 */

type Write = { columns: Record<string, unknown>; filters: [string, string, unknown][] };

function database(unplaced: AimToPlace[]) {
  const writes: Write[] = [];
  const stub = {
    from(table: string) {
      if (table === 'area_fields') {
        return {
          select: async () => ({
            data: [
              { id: 'field-urban', slug: 'urban-planning', name: 'Urban planning', scope: 'Cities.', position: 1, domain: { name: 'Society', position: 1 } },
              { id: 'field-fin', slug: 'finance', name: 'Finance', scope: 'Money.', position: 2, domain: { name: 'Society', position: 1 } },
            ],
            error: null,
          }),
        };
      }
      if (table === 'area_domains') {
        return {
          select: () => ({
            order: async () => ({
              data: [{ id: 'domain-society', slug: 'society', name: 'Society', scope: 'People.' }],
              error: null,
            }),
          }),
        };
      }
      // aims: the read of unplaced goals, or the write of one placement.
      return {
        select: () => {
          const read = { is: () => read, order: async () => ({ data: unplaced, error: null }) };
          return read;
        },
        update: (columns: Record<string, unknown>) => {
          const write: Write = { columns, filters: [] };
          writes.push(write);
          const chain = {
            eq: (column: string, value: unknown) => (write.filters.push(['eq', column, value]), chain),
            is: (column: string, value: unknown) => (write.filters.push(['is', column, value]), chain),
            select: async () => ({ data: [{ id: 'x' }], error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { supabase: stub as never, writes };
}

function model(placements: unknown[]) {
  const create = vi.fn<(request: unknown) => Promise<unknown>>(async () => ({
    content: [{ type: 'tool_use', name: 'report_placements', input: { placements } }],
    usage: { input_tokens: 100, output_tokens: 20 },
  }));
  return { client: { messages: { create } } as never, create };
}

const URBANISM: AimToPlace = { id: 'aim-1', name: 'City design and urbanism', about: null };

describe('placing goals', () => {
  beforeEach(() => recordLearnSpend.mockClear());

  it('places a goal in the field the model names and records the spend', async () => {
    const { supabase, writes } = database([URBANISM]);
    const { client, create } = model([
      { title: 'City design and urbanism', kind: 'topic', field: 'urban-planning', runner_up: null, confidence: 'clear', basis: 'Urban planning studies city design.' },
    ]);

    const outcome = await placeAims(supabase, 'user-1', { client });

    expect(outcome).toEqual({ placed: 1, failed: 0 });
    const prompt = JSON.stringify(create.mock.calls[0][0]);
    expect(prompt).toContain('City design and urbanism (a subject to learn about');
    expect(writes).toHaveLength(1);
    expect(writes[0].columns).toMatchObject({
      field_id: 'field-urban',
      domain_id: null,
      placement_confidence: 'clear',
      placement_basis: 'Urban planning studies city design.',
    });
    expect(writes[0].columns.placed_at).toEqual(expect.any(String));
    // Only onto the same goal, still open, unplaced and worded as it was sent.
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'aim-1'],
        ['eq', 'name', 'City design and urbanism'],
        ['is', 'archived_at', null],
        ['is', 'placed_at', null],
        ['is', 'about', null],
      ]),
    );
    expect(recordLearnSpend).toHaveBeenCalledWith('user-1', 'place-aim', [expect.anything()]);
  });

  it('writes a domain, or neither for a goal that spans domains', async () => {
    const finance: AimToPlace = { id: 'aim-2', name: 'Startup finance and FP&A', about: 'Planning and modelling.' };
    const { supabase, writes } = database([URBANISM, finance]);
    const { client } = model([
      { title: 'City design and urbanism', kind: 'topic', field: 'domain:society', confidence: 'close', basis: 'Covers all of society.' },
      { title: 'Startup finance and FP&A', kind: 'topic', field: 'unplaced', confidence: 'none', basis: 'Spans domains.' },
    ]);

    expect(await placeAims(supabase, 'user-1', { client })).toEqual({ placed: 2, failed: 0 });
    expect(writes[0].columns).toMatchObject({ field_id: null, domain_id: 'domain-society' });
    expect(writes[1].columns).toMatchObject({ field_id: null, domain_id: null, placement_basis: 'Spans domains.' });
    expect(writes[1].filters).toContainEqual(['eq', 'about', 'Planning and modelling.']);
  });

  it('writes nothing and reports the failure when the model call fails', async () => {
    const { supabase, writes } = database([URBANISM]);
    const create = vi.fn(async () => {
      throw new Error('overloaded');
    });
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await placeAims(supabase, 'user-1', { client: { messages: { create } } as never });

    expect(outcome).toEqual({ placed: 0, failed: 1 });
    expect(writes).toHaveLength(0);
    onError.mockRestore();
  });

  it('makes no call when every goal is placed', async () => {
    const { supabase } = database([]);
    const { client, create } = model([]);
    expect(await placeAims(supabase, 'user-1', { client })).toEqual({ placed: 0, failed: 0 });
    expect(create).not.toHaveBeenCalled();
  });
});

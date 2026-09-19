import { describe, expect, it, vi } from 'vitest';

/**
 * What the command box asks shopping for.
 *
 * Stubbed rather than run against Postgres, and narrowed to the orders reads:
 * an order number is matched by `ilike` on its own now, where it used to be
 * one condition inside an `or` and a comma in it split the expression. The
 * stub has no `or` method, so going back to one would fail here rather than
 * drop shopping from the results.
 */

type OrderRow = {
  id: string;
  external_order_number: string | null;
  order_date: string | null;
  merchants: { name: string } | null;
};

type Rows = { byNumber?: OrderRow[]; byMerchant?: OrderRow[] };

const stub = vi.hoisted(() => ({
  rows: {} as Rows,
  filters: [] as Array<[string, string]>,
}));

vi.mock('@/lib/auth/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const read = {
        table,
        column: null as string | null,
        is: () => read,
        ilike(column: string, pattern: string) {
          read.column = column;
          if (table === 'orders') stub.filters.push([column, pattern]);
          return read;
        },
        order: () => read,
        limit: async () => {
          if (table !== 'orders') return { data: [], error: null };
          return {
            data:
              read.column === 'merchants.name'
                ? (stub.rows.byMerchant ?? [])
                : (stub.rows.byNumber ?? []),
            error: null,
          };
        },
      };
      return { select: () => read };
    },
  }),
}));

import { shoppingSearchSource } from '@/lib/search/sources/shopping';

function given(rows: Rows = {}) {
  stub.rows = rows;
  stub.filters.length = 0;
}

const order = (id: string, number: string | null, merchant: string | null): OrderRow => ({
  id,
  external_order_number: number,
  order_date: '2026-03-01',
  merchants: merchant ? { name: merchant } : null,
});

describe('shoppingSearchSource', () => {
  it('matches an order number with a comma in it', async () => {
    given({ byNumber: [order('o1', '112,3456', 'Acme')] });

    const hits = await shoppingSearchSource.find({
      userId: 'user-1',
      query: '112,3456',
      limit: 6,
    });

    expect(hits.map((hit) => hit.id)).toEqual(['o1']);
    expect(hits[0].title).toBe('Acme · 112,3456');
    // The comma goes out inside the pattern rather than as the separator
    // between two conditions of an `or`.
    expect(stub.filters).toEqual([
      ['external_order_number', '%112,3456%'],
      ['merchants.name', '%112,3456%'],
    ]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    given();

    await shoppingSearchSource.find({ userId: 'user-1', query: '50%_off', limit: 6 });

    expect(stub.filters).toEqual([
      ['external_order_number', '%50\\%\\_off%'],
      ['merchants.name', '%50\\%\\_off%'],
    ]);
  });

  it('lists an order once when its number and its merchant both match', async () => {
    given({
      byNumber: [order('o1', 'acme-1', 'Acme')],
      byMerchant: [order('o1', 'acme-1', 'Acme'), order('o2', null, 'Acme')],
    });

    const hits = await shoppingSearchSource.find({ userId: 'user-1', query: 'acme', limit: 6 });

    expect(hits.map((hit) => hit.id)).toEqual(['o1', 'o2']);
  });

  it('sends no order filters for the whole list', async () => {
    given({ byNumber: [order('o1', 'acme-1', 'Acme')] });

    const hits = await shoppingSearchSource.list({ userId: 'user-1', limit: 500 });

    expect(hits.map((hit) => hit.id)).toEqual(['o1']);
    expect(stub.filters).toEqual([]);
  });
});

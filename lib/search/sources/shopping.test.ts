import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a shopping search asks the database for.
 *
 * The order number used to be matched from inside an `or` expression holding
 * one condition. PostgREST reads a comma in one of those as the separator
 * between its sides, so a search for "amazon, march" sent a filter that does
 * not parse, and the palette dropped the shopping source rather than failing
 * the page -- the symptom being orders missing from the results. It is a plain
 * `ilike` now, which passes the pattern as its own parameter.
 */

type OrderRow = {
  id: string;
  external_order_number: string | null;
  order_date: string | null;
  total_cents: number | null;
  merchants: { name: string } | null;
};

const ilikes: Array<[string, string]> = [];
const ors: string[] = [];
let orders: { byNumber?: OrderRow[]; byMerchant?: OrderRow[] } = {};

/**
 * A stand-in for the session client: enough of the builder for the three
 * parallel reads the source makes, recording every filter it was given. Only
 * the orders carry rows; inventory and saved items are matched with an `ilike`
 * already and come back empty.
 */
function client() {
  return {
    from(table: string) {
      let embedded = false;
      let matched: OrderRow[] = [];

      const read = {
        select(columns: string) {
          embedded = columns.includes('merchants!inner');
          return read;
        },
        is: () => read,
        // Kept on the stub although nothing should call it: an `or` is what a
        // comma in the query broke, so one has to show up in the assertions
        // rather than pass unnoticed.
        or(expression: string) {
          ors.push(expression);
          return read;
        },
        ilike(column: string, pattern: string) {
          ilikes.push([column, pattern]);
          if (table !== 'orders') return read;
          matched = (embedded ? orders.byMerchant : orders.byNumber) ?? [];
          return read;
        },
        order: () => read,
        limit: () => Promise.resolve({ data: matched, error: null }),
      };

      return read as never;
    },
  };
}

vi.mock('@/lib/auth/server', () => ({ createClient: async () => client() }));

const { shoppingSearchSource } = await import('./shopping');

function order(id: string, number: string | null, merchant: string | null): OrderRow {
  return {
    id,
    external_order_number: number,
    order_date: '2026-03-01',
    total_cents: 1000,
    merchants: merchant ? { name: merchant } : null,
  };
}

describe('shoppingSearchSource', () => {
  beforeEach(() => {
    ilikes.length = 0;
    ors.length = 0;
    orders = {};
  });

  it('finds an order by a number with a comma in it', async () => {
    orders = { byNumber: [order('o1', 'A1,B2', 'Amazon')] };

    const hits = await shoppingSearchSource.find({
      userId: 'user-1',
      limit: 10,
      query: 'A1,B2',
    });

    expect(hits.map((hit) => hit.id)).toEqual(['o1']);
    expect(ors).toEqual([]);
    expect(ilikes).toContainEqual(['external_order_number', '%A1,B2%']);
  });

  it('takes a typed % or _ as the character it is', async () => {
    await shoppingSearchSource.find({ userId: 'user-1', limit: 10, query: '50%_x' });

    expect(ors).toEqual([]);
    expect(ilikes).toContainEqual(['external_order_number', '%50\\%\\_x%']);
    expect(ilikes).toContainEqual(['merchants.name', '%50\\%\\_x%']);
  });

  it('still lists each order once when the number and the merchant both match', async () => {
    const both = order('o1', 'AMZ-1', 'Amazon');
    orders = { byNumber: [both], byMerchant: [both] };

    const hits = await shoppingSearchSource.find({
      userId: 'user-1',
      limit: 10,
      query: 'amz',
    });

    expect(hits.map((hit) => hit.id)).toEqual(['o1']);
    expect(hits[0].title).toBe('Amazon · AMZ-1');
  });
});

import { describe, expect, it } from 'vitest';
import { ordersDisplay, type SortableOrder } from './list-display';
import { groupRows, parseListDisplay, sortRows } from '@/lib/list-display';

/**
 * The orders list's arrangement, which until now was one hand-built month
 * bucket and no sort control at all.
 *
 * The property worth holding onto is that every total compared here is already
 * in the display currency. A sort or a subtotal over native totals would put a
 * 50,000 yen order above a 400 dollar one and add them together as though they
 * were the same thing.
 */

function order(over: Partial<SortableOrder>): SortableOrder {
  return {
    orderDate: '2024-03-04',
    displayTotalCents: 1000,
    merchantName: 'Amazon',
    status: 'ordered',
    statusLabel: 'Ordered',
    statusRank: 0,
    personName: null,
    ...over,
  };
}

const spec = ordersDisplay<SortableOrder>();

const orders = [
  order({ orderDate: '2024-03-04', displayTotalCents: 4000, merchantName: 'Target', status: 'delivered', statusLabel: 'Delivered', statusRank: 2 }),
  order({ orderDate: '2024-02-20', displayTotalCents: 900, merchantName: 'Amazon' }),
  order({ orderDate: '2024-03-19', displayTotalCents: 2500, merchantName: 'Amazon', status: 'shipped', statusLabel: 'Shipped', statusRank: 1 }),
];

const arranged = (params: Record<string, string>) => parseListDisplay(spec, params);

describe('how it opens', () => {
  it('is newest first, grouped by month, as it always was', () => {
    const state = arranged({});
    expect(state.sort).toBe('newest');
    expect(state.group).toBe('month');
    expect(sortRows(orders, state).map((row) => row.orderDate)).toEqual([
      '2024-03-19',
      '2024-03-04',
      '2024-02-20',
    ]);
  });

  it('puts the newest month first and totals each one', () => {
    const groups = groupRows(orders, arranged({}).groupBy, (rows) =>
      rows.reduce((sum, row) => sum + row.displayTotalCents, 0),
    );
    expect(groups.map((group) => group.label)).toEqual(['March 2024', 'February 2024']);
    expect(groups[0].subtotal).toBe(6500);
    expect(groups[0].count).toBe(2);
  });
});

describe('the sorts it gained', () => {
  it('sorts on the converted total, high to low', () => {
    const sorted = sortRows(orders, arranged({ sort: 'total_desc' }));
    expect(sorted.map((row) => row.displayTotalCents)).toEqual([4000, 2500, 900]);
  });

  it('sorts on the converted total, low to high', () => {
    const sorted = sortRows(orders, arranged({ sort: 'total_asc' }));
    expect(sorted.map((row) => row.displayTotalCents)).toEqual([900, 2500, 4000]);
  });

  it('falls back to newest on a sort it does not offer', () => {
    expect(arranged({ sort: 'cheapest' }).sort).toBe('newest');
  });
});

describe('the groupings it gained', () => {
  it('groups by merchant', () => {
    const groups = groupRows(orders, arranged({ group: 'merchant' }).groupBy);
    expect(groups.map((group) => group.label)).toEqual(['Amazon', 'Target']);
  });

  it('groups by status in the order an order moves through them', () => {
    // Alphabetical would read "Delivered, Ordered, Shipped", which is the
    // order of nothing.
    const groups = groupRows(orders, arranged({ group: 'status' }).groupBy);
    expect(groups.map((group) => group.label)).toEqual(['Ordered', 'Shipped', 'Delivered']);
  });

  it('offers no person grouping on a one-person account', () => {
    const alone = ordersDisplay<SortableOrder>({ withPeople: false });
    expect(alone.groups?.map((group) => group.id)).toEqual(['month', 'merchant', 'status']);
  });

  it('drops the grouping entirely when asked to', () => {
    const groups = groupRows(orders, arranged({ group: 'none' }).groupBy);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });
});

describe('the lines a row can lose', () => {
  it('never offers to hide the merchant', () => {
    expect(spec.properties?.find((property) => property.id === 'merchant')?.alwaysOn).toBe(true);
  });

  it('carries what is hidden through the URL', () => {
    expect(arranged({ hide: 'number,inbox' }).hidden).toEqual(['number', 'inbox']);
  });
});

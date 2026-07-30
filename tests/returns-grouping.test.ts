import { describe, expect, it } from 'vitest';
import { groupReturnsByOrder, parseReturnsGroup } from '@/lib/returns/grouping';
import type { ReturnsTrackerRow } from '@/lib/returns/types';

function row(
  partial: Partial<ReturnsTrackerRow> &
    Pick<ReturnsTrackerRow, 'inventoryItemId' | 'orderId' | 'name'>,
): ReturnsTrackerRow {
  return {
    variant: null,
    costCents: 1000,
    orderDate: '2026-03-01',
    externalOrderNumber: null,
    orderStatus: 'delivered',
    merchantId: 'm1',
    merchantName: 'Sephora',
    returnDeadline: '2026-04-01',
    daysLeft: 10,
    returnPlanned: false,
    returnWindowDays: 30,
    delivered: true,
    status: 'owned',
    returnId: null,
    refundedAt: null,
    ...partial,
  };
}

describe('parseReturnsGroup', () => {
  it('defaults to items', () => {
    expect(parseReturnsGroup(undefined)).toBe('items');
    expect(parseReturnsGroup('items')).toBe('items');
    expect(parseReturnsGroup('nope')).toBe('items');
  });

  it('accepts orders', () => {
    expect(parseReturnsGroup('orders')).toBe('orders');
  });
});

describe('groupReturnsByOrder', () => {
  it('groups items under the same order and ranks by soonest deadline', () => {
    const rows = [
      row({
        inventoryItemId: 'a',
        orderId: 'o2',
        name: 'Later',
        daysLeft: 20,
        returnDeadline: '2026-04-20',
        merchantName: 'Revolve',
        externalOrderNumber: 'R-2',
      }),
      row({
        inventoryItemId: 'b',
        orderId: 'o1',
        name: 'Soon',
        daysLeft: 3,
        returnDeadline: '2026-03-04',
        externalOrderNumber: 'S-1',
        returnPlanned: true,
      }),
      row({
        inventoryItemId: 'c',
        orderId: 'o1',
        name: 'Also soon',
        daysLeft: 5,
        returnDeadline: '2026-03-06',
        externalOrderNumber: 'S-1',
      }),
    ];

    const groups = groupReturnsByOrder(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].orderId).toBe('o1');
    expect(groups[0].items.map((item) => item.inventoryItemId)).toEqual(['b', 'c']);
    expect(groups[0].daysLeft).toBe(3);
    expect(groups[0].plannedCount).toBe(1);
    expect(groups[0].externalOrderNumber).toBe('S-1');
    expect(groups[1].orderId).toBe('o2');
  });
});

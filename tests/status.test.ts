/**
 * Order status derivation, and the agreement check that keeps it honest.
 *
 * The database owns this rule. lib/status.ts restates it for optimistic UI and
 * tests. The second describe block below runs every case through both and
 * asserts they agree, so the TypeScript copy cannot quietly drift from the SQL
 * that actually decides what a user sees.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db';
import {
  deriveInventoryStatus,
  deriveOrderStatus,
  deriveReturnDeadline,
  type InventoryStatus,
  type OrderStatus,
  type ShipmentStatus,
} from '../lib/status';

interface Case {
  name: string;
  cancelled: boolean;
  inventoryStatuses: InventoryStatus[];
  shipmentStatuses: ShipmentStatus[];
  expected: OrderStatus;
}

const CASES: Case[] = [
  {
    name: 'no shipments, no returns',
    cancelled: false,
    inventoryStatuses: ['owned', 'owned'],
    shipmentStatuses: [],
    expected: 'ordered',
  },
  {
    name: 'a shipment in transit',
    cancelled: false,
    inventoryStatuses: ['owned'],
    shipmentStatuses: ['in_transit'],
    expected: 'shipped',
  },
  {
    name: 'one of two shipments delivered',
    cancelled: false,
    inventoryStatuses: ['owned', 'owned'],
    shipmentStatuses: ['delivered', 'in_transit'],
    expected: 'shipped',
  },
  {
    name: 'all shipments delivered',
    cancelled: false,
    inventoryStatuses: ['owned', 'owned'],
    shipmentStatuses: ['delivered', 'delivered'],
    expected: 'delivered',
  },
  {
    name: 'one of two units returned',
    cancelled: false,
    inventoryStatuses: ['returned', 'owned'],
    shipmentStatuses: ['delivered'],
    expected: 'partially_returned',
  },
  {
    name: 'every unit returned',
    cancelled: false,
    inventoryStatuses: ['returned', 'returned'],
    shipmentStatuses: ['delivered'],
    expected: 'returned',
  },
  {
    name: 'cancelled outranks everything',
    cancelled: true,
    inventoryStatuses: ['returned', 'returned'],
    shipmentStatuses: ['delivered'],
    expected: 'cancelled',
  },
  {
    name: 'a disposed unit is not a returned unit',
    cancelled: false,
    inventoryStatuses: ['disposed', 'owned'],
    shipmentStatuses: ['delivered'],
    expected: 'delivered',
  },
  {
    name: 'a pending shipment has not shipped',
    cancelled: false,
    inventoryStatuses: ['owned'],
    shipmentStatuses: ['pending'],
    expected: 'ordered',
  },
  {
    name: 'an exception still counts as shipped',
    cancelled: false,
    inventoryStatuses: ['owned'],
    shipmentStatuses: ['exception'],
    expected: 'shipped',
  },
];

describe('deriveOrderStatus', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(
        deriveOrderStatus({
          cancelled: c.cancelled,
          inventoryStatuses: c.inventoryStatuses,
          shipmentStatuses: c.shipmentStatuses,
        }),
      ).toBe(c.expected);
    });
  }
});

describe('deriveReturnDeadline', () => {
  it('is delivery date plus the merchant window', () => {
    expect(
      deriveReturnDeadline({
        deliveredAt: '2026-03-01T12:00:00Z',
        merchantReturnWindowDays: 60,
      }),
    ).toBe('2026-04-30');
  });

  it('is null when the merchant has no seeded window', () => {
    // Showing nothing beats guessing: the user acts on this date.
    expect(
      deriveReturnDeadline({
        deliveredAt: '2026-03-01T12:00:00Z',
        merchantReturnWindowDays: null,
      }),
    ).toBeNull();
  });

  it('is null before anything is delivered', () => {
    expect(
      deriveReturnDeadline({ deliveredAt: null, merchantReturnWindowDays: 30 }),
    ).toBeNull();
  });
});

describe('deriveInventoryStatus', () => {
  it('marks a unit returned once its return is refunded', () => {
    expect(
      deriveInventoryStatus({ current: 'owned', returnStatuses: ['refunded'] }),
    ).toBe('returned');
  });

  it('leaves a unit owned while a return is only initiated', () => {
    expect(
      deriveInventoryStatus({ current: 'owned', returnStatuses: ['initiated'] }),
    ).toBe('owned');
  });

  it('leaves a unit owned when the merchant denied the return', () => {
    expect(deriveInventoryStatus({ current: 'owned', returnStatuses: ['denied'] })).toBe(
      'owned',
    );
  });
});

/**
 * The anti-drift check. Every case above is materialised in Postgres and the
 * trigger-maintained orders.status is compared against the TypeScript answer.
 */
describe('the SQL derivation and the TypeScript derivation agree', () => {
  let userId: string;
  let merchantId: string;

  beforeAll(async () => {
    await truncateAll();
    userId = await createUser('status@example.com');
    const [merchant] = await admin<{ id: string }[]>`
      select id from merchants where slug = 'nike' and is_global limit 1`;
    merchantId = merchant.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  for (const [i, c] of CASES.entries()) {
    it(c.name, async () => {
      const [order] = await admin<{ id: string }[]>`
        insert into orders (user_id, merchant_id, order_date, external_order_number,
                            subtotal_cents, total_cents, cancelled_at)
        values (${userId}, ${merchantId}, current_date, ${`case-${i}`}, 1000, 1000,
                ${c.cancelled ? admin`now()` : null})
        returning id`;

      const [orderItem] = await admin<{ id: string }[]>`
        insert into order_items (order_id, name, quantity, unit_price_cents)
        values (${order.id}, 'widget', ${Math.max(1, c.inventoryStatuses.length)}, 1000)
        returning id`;

      for (const status of c.inventoryStatuses) {
        await admin`
          insert into inventory_items (user_id, order_item_id, name, cost_cents,
                                       status, disposed_at)
          values (${userId}, ${orderItem.id}, 'widget', 1000, ${status},
                  ${status === 'disposed' ? admin`current_date` : null})`;
      }

      for (const status of c.shipmentStatuses) {
        await admin`
          insert into shipments (order_id, status, delivered_at)
          values (${order.id}, ${status},
                  ${status === 'delivered' ? admin`now()` : null})`;
      }

      const [row] = await admin<{ status: OrderStatus }[]>`
        select status from orders where id = ${order.id}`;

      const inTypeScript = deriveOrderStatus({
        cancelled: c.cancelled,
        inventoryStatuses: c.inventoryStatuses,
        shipmentStatuses: c.shipmentStatuses,
      });

      expect(row.status, 'SQL disagrees with lib/status.ts').toBe(inTypeScript);
      expect(row.status).toBe(c.expected);
    });
  }

  it('computes the return deadline from the merchant window on delivery', async () => {
    const [order] = await admin<{ id: string }[]>`
      insert into orders (user_id, merchant_id, order_date, external_order_number,
                          subtotal_cents, total_cents)
      values (${userId}, ${merchantId}, current_date, 'deadline-1', 1000, 1000)
      returning id`;

    await admin`
      insert into shipments (order_id, status, delivered_at)
      values (${order.id}, 'delivered', '2026-03-01T12:00:00Z')`;

    const [row] = await admin<{ return_deadline: Date | string | null }[]>`
      select return_deadline from orders where id = ${order.id}`;

    // Nike is seeded at 60 days
    const asString =
      row.return_deadline instanceof Date
        ? row.return_deadline.toISOString().slice(0, 10)
        : row.return_deadline;
    expect(asString).toBe(
      deriveReturnDeadline({
        deliveredAt: '2026-03-01T12:00:00Z',
        merchantReturnWindowDays: 60,
      }),
    );
  });

  it('leaves the return deadline null for a merchant with no seeded window', async () => {
    const [costco] = await admin<{ id: string }[]>`
      select id from merchants where slug = 'costco' and is_global limit 1`;

    const [order] = await admin<{ id: string }[]>`
      insert into orders (user_id, merchant_id, order_date, external_order_number,
                          subtotal_cents, total_cents)
      values (${userId}, ${costco.id}, current_date, 'deadline-2', 1000, 1000)
      returning id`;

    await admin`
      insert into shipments (order_id, status, delivered_at)
      values (${order.id}, 'delivered', now())`;

    const [row] = await admin<{ return_deadline: unknown }[]>`
      select return_deadline from orders where id = ${order.id}`;
    expect(row.return_deadline).toBeNull();
  });

  it('prefers a user return-policy override when computing the deadline', async () => {
    const [order] = await admin<{ id: string }[]>`
      insert into orders (user_id, merchant_id, order_date, external_order_number,
                          subtotal_cents, total_cents)
      values (${userId}, ${merchantId}, current_date, 'deadline-override', 1000, 1000)
      returning id`;

    await admin`
      insert into shipments (order_id, status, delivered_at)
      values (${order.id}, 'delivered', '2026-03-01T12:00:00Z')`;

    // Nike seed is 60; override to 10.
    await admin`
      insert into merchant_return_policies (user_id, merchant_id, return_window_days)
      values (${userId}, ${merchantId}, 10)`;

    const [row] = await admin<{ return_deadline: Date | string | null }[]>`
      select return_deadline from orders where id = ${order.id}`;
    const asString =
      row.return_deadline instanceof Date
        ? row.return_deadline.toISOString().slice(0, 10)
        : row.return_deadline;
    expect(asString).toBe(
      deriveReturnDeadline({
        deliveredAt: '2026-03-01T12:00:00Z',
        merchantReturnWindowDays: 10,
      }),
    );
  });

  it('clears return_planned when a unit is refunded', async () => {
    const [order] = await admin<{ id: string }[]>`
      insert into orders (user_id, merchant_id, order_date, external_order_number,
                          subtotal_cents, total_cents)
      values (${userId}, ${merchantId}, current_date, 'planned-clear', 1000, 1000)
      returning id`;
    const [orderItem] = await admin<{ id: string }[]>`
      insert into order_items (order_id, name, quantity, unit_price_cents)
      values (${order.id}, 'boot', 1, 1000) returning id`;
    const [item] = await admin<{ id: string }[]>`
      insert into inventory_items (user_id, order_item_id, name, cost_cents,
                                   status, return_planned)
      values (${userId}, ${orderItem.id}, 'boot', 1000, 'owned', true)
      returning id`;

    await admin`
      insert into returns (user_id, order_id, inventory_item_id, initiated_at,
                           refund_amount_cents, status, refunded_at)
      values (${userId}, ${order.id}, ${item.id}, current_date, 1000,
              'refunded', current_date)`;

    const [row] = await admin<{ status: string; return_planned: boolean }[]>`
      select status, return_planned from inventory_items where id = ${item.id}`;
    expect(row.status).toBe('returned');
    expect(row.return_planned).toBe(false);
  });
});

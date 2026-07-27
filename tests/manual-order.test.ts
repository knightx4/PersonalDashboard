/**
 * End-to-end coverage for build step 6 write paths against real Postgres:
 * one inventory row per physical unit, landed-cost allocation, and marking
 * returned via a refunded `returns` row (never by writing status directly).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildManualOrder } from '@/lib/orders/create-manual-order';
import { inventoryStatusForDisposal } from '@/lib/inventory/status-actions';
import { asUser, closeDb, createUser, truncateAll, admin } from './helpers/db';

describe('manual order + inventory write paths', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('persists one inventory row per unit with allocateLandedCost cents', async () => {
    const userId = await createUser('manual@example.com');
    const [merchant] = await admin<{ id: string; slug: string }[]>`
      select id, slug from merchants where slug = 'nike' limit 1
    `;
    expect(merchant).toBeTruthy();

    const built = buildManualOrder({
      userId,
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
      orderDate: '2026-03-15',
      taxCents: 3_600,
      shippingCents: 1_000,
      discountCents: 0,
      lines: [
        { name: 'Coat', quantity: 1, unitPriceCents: 40_000 },
        { name: 'Socks', quantity: 2, unitPriceCents: 600 },
      ],
    });

    await asUser(userId, async (tx) => {
      await tx`
        insert into orders (
          id, user_id, merchant_id, source, order_date,
          subtotal_cents, tax_cents, shipping_cents, discount_cents, total_cents
        ) values (
          ${built.order.id}, ${built.order.userId}, ${built.order.merchantId},
          ${built.order.source}, ${built.order.orderDate},
          ${built.order.subtotalCents}, ${built.order.taxCents},
          ${built.order.shippingCents}, ${built.order.discountCents},
          ${built.order.totalCents}
        )
      `;

      for (const item of built.orderItems) {
        await tx`
          insert into order_items (
            id, order_id, name, variant, quantity, unit_price_cents,
            fingerprint_strict, fingerprint_loose
          ) values (
            ${item.id}, ${item.orderId}, ${item.name}, ${item.variant},
            ${item.quantity}, ${item.unitPriceCents},
            ${item.fingerprintStrict}, ${item.fingerprintLoose}
          )
        `;
      }

      for (const item of built.inventoryItems) {
        await tx`
          insert into inventory_items (
            id, user_id, order_item_id, name, variant, fingerprint_loose,
            acquired_at, cost_cents
          ) values (
            ${item.id}, ${item.userId}, ${item.orderItemId}, ${item.name},
            ${item.variant}, ${item.fingerprintLoose}, ${item.acquiredAt},
            ${item.costCents}
          )
        `;
      }
    });

    const units = await admin<{ name: string; cost_cents: number; status: string }[]>`
      select name, cost_cents, status
      from inventory_items
      where user_id = ${userId}
      order by cost_cents desc
    `;
    expect(units).toHaveLength(3);
    expect(units.map((u) => u.cost_cents)).toEqual([44_466, 667, 667]);
    expect(units.every((u) => u.status === 'owned')).toBe(true);

    const [order] = await admin<{ status: string; total_cents: number }[]>`
      select status, total_cents from orders where id = ${built.order.id}
    `;
    expect(order.total_cents).toBe(45_800);
    expect(order.status).toBe('ordered');
  });

  it('marks returned through a refunded returns row, not a status write', async () => {
    const userId = await createUser('returner@example.com');
    const built = buildManualOrder({
      userId,
      merchantId: null,
      merchantSlug: null,
      orderDate: '2026-02-01',
      taxCents: 0,
      shippingCents: 0,
      discountCents: 0,
      lines: [{ name: 'Mug', quantity: 1, unitPriceCents: 1_200 }],
    });

    await asUser(userId, async (tx) => {
      await tx`
        insert into orders (
          id, user_id, source, order_date,
          subtotal_cents, tax_cents, shipping_cents, discount_cents, total_cents
        ) values (
          ${built.order.id}, ${userId}, 'manual', ${built.order.orderDate},
          ${built.order.subtotalCents}, 0, 0, 0, ${built.order.totalCents}
        )
      `;
      const item = built.orderItems[0];
      await tx`
        insert into order_items (
          id, order_id, name, quantity, unit_price_cents,
          fingerprint_strict, fingerprint_loose
        ) values (
          ${item.id}, ${built.order.id}, ${item.name}, 1, 1200,
          ${item.fingerprintStrict}, ${item.fingerprintLoose}
        )
      `;
      const unit = built.inventoryItems[0];
      await tx`
        insert into inventory_items (
          id, user_id, order_item_id, name, fingerprint_loose, acquired_at, cost_cents
        ) values (
          ${unit.id}, ${userId}, ${item.id}, ${unit.name},
          ${unit.fingerprintLoose}, ${unit.acquiredAt}, ${unit.costCents}
        )
      `;

      await tx`
        insert into returns (
          user_id, order_id, inventory_item_id, initiated_at,
          refund_amount_cents, status, refunded_at
        ) values (
          ${userId}, ${built.order.id}, ${unit.id}, '2026-02-10',
          ${unit.costCents}, 'refunded', '2026-02-10'
        )
      `;
    });

    const [unit] = await admin<{ status: string }[]>`
      select status from inventory_items where id = ${built.inventoryItems[0].id}
    `;
    expect(unit.status).toBe('returned');

    const [order] = await admin<{ status: string }[]>`
      select status from orders where id = ${built.order.id}
    `;
    expect(order.status).toBe('returned');
  });

  it('maps disposal methods to non-returned statuses', () => {
    expect(inventoryStatusForDisposal('sold')).toBe('sold');
    expect(inventoryStatusForDisposal('gifted')).toBe('gifted');
    expect(inventoryStatusForDisposal('donated')).toBe('disposed');
    expect(inventoryStatusForDisposal('trashed')).toBe('disposed');
    expect(inventoryStatusForDisposal('recycled')).toBe('disposed');
  });
});

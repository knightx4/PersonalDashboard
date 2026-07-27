/**
 * Build the rows for a manually entered order.
 *
 * Pure: no database, no auth. The server action validates the session, looks
 * up the merchant, and writes what this returns. Keeping allocation here means
 * the one-row-per-physical-unit rule is testable without Postgres.
 *
 * Status columns are deliberately absent. orders.status and a "returned"
 * inventory status are owned by public.sync_order_state(); writing them here
 * would invent a second source of truth.
 */
import { randomUUID } from 'node:crypto';
import { fingerprints } from '@/lib/fingerprint';
import {
  allocateLandedCost,
  assertIntegerCents,
  computeOrderTotalCents,
  orderSubtotalCents,
  type AllocatedUnit,
  type OrderTotals,
} from '@/lib/money';

export interface ManualOrderLineInput {
  name: string;
  variant?: string | null;
  quantity: number;
  unitPriceCents: number;
  categoryId?: string | null;
}

export interface ManualOrderInput {
  userId: string;
  merchantId: string | null;
  merchantSlug: string | null;
  externalOrderNumber?: string | null;
  orderDate: string;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  currency?: string;
  lines: readonly ManualOrderLineInput[];
}

export interface ManualOrderItemRow {
  id: string;
  orderId: string;
  categoryId: string | null;
  name: string;
  variant: string | null;
  quantity: number;
  unitPriceCents: number;
  fingerprintStrict: string;
  fingerprintLoose: string;
}

export interface ManualInventoryItemRow {
  id: string;
  userId: string;
  orderItemId: string;
  categoryId: string | null;
  name: string;
  variant: string | null;
  fingerprintLoose: string;
  acquiredAt: string;
  costCents: number;
}

export interface ManualOrderBundle {
  order: {
    id: string;
    userId: string;
    merchantId: string | null;
    source: 'manual';
    externalOrderNumber: string | null;
    orderDate: string;
    subtotalCents: number;
    taxCents: number;
    shippingCents: number;
    discountCents: number;
    totalCents: number;
    currency: string;
  };
  orderItems: ManualOrderItemRow[];
  inventoryItems: ManualInventoryItemRow[];
  allocated: AllocatedUnit[];
  totals: OrderTotals;
}

export function buildManualOrder(input: ManualOrderInput): ManualOrderBundle {
  if (input.lines.length === 0) {
    throw new RangeError('an order needs at least one line item');
  }

  for (const line of input.lines) {
    if (!line.name.trim()) throw new RangeError('every line needs a name');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`quantity must be a positive integer, got ${line.quantity}`);
    }
    assertIntegerCents(line.unitPriceCents);
  }
  assertIntegerCents(input.taxCents);
  assertIntegerCents(input.shippingCents);
  assertIntegerCents(input.discountCents);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.orderDate)) {
    throw new TypeError(`orderDate must be YYYY-MM-DD, got ${input.orderDate}`);
  }

  const subtotalCents = orderSubtotalCents(input.lines);
  const totalCents = computeOrderTotalCents({
    subtotalCents,
    taxCents: input.taxCents,
    shippingCents: input.shippingCents,
    discountCents: input.discountCents,
  });

  const totals: OrderTotals = {
    subtotalCents,
    taxCents: input.taxCents,
    shippingCents: input.shippingCents,
    discountCents: input.discountCents,
    totalCents,
  };

  const orderId = randomUUID();
  const orderItems: ManualOrderItemRow[] = input.lines.map((line) => {
    const fps = fingerprints({
      merchantSlug: input.merchantSlug,
      name: line.name,
      variant: line.variant,
    });
    return {
      id: randomUUID(),
      orderId,
      categoryId: line.categoryId ?? null,
      name: line.name.trim(),
      variant: line.variant?.trim() ? line.variant.trim() : null,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      fingerprintStrict: fps.strict,
      fingerprintLoose: fps.loose,
    };
  });

  const allocated = allocateLandedCost(
    orderItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
    totals,
  );

  const itemsById = new Map(orderItems.map((item) => [item.id, item]));
  const inventoryItems: ManualInventoryItemRow[] = allocated.map((unit) => {
    const item = itemsById.get(unit.orderItemId)!;
    return {
      id: randomUUID(),
      userId: input.userId,
      orderItemId: item.id,
      categoryId: item.categoryId,
      name: item.name,
      variant: item.variant,
      fingerprintLoose: item.fingerprintLoose,
      acquiredAt: input.orderDate,
      costCents: unit.costCents,
    };
  });

  return {
    order: {
      id: orderId,
      userId: input.userId,
      merchantId: input.merchantId,
      source: 'manual',
      externalOrderNumber: input.externalOrderNumber?.trim()
        ? input.externalOrderNumber.trim()
        : null,
      orderDate: input.orderDate,
      subtotalCents,
      taxCents: input.taxCents,
      shippingCents: input.shippingCents,
      discountCents: input.discountCents,
      totalCents,
      currency: input.currency ?? 'USD',
    },
    orderItems,
    inventoryItems,
    allocated,
    totals,
  };
}

/**
 * Build rows for an email-sourced order. Mirrors create-manual-order but
 * source is 'email' and needsReview can be set when reconcile was soft-failed
 * upstream (callers should prefer not writing when applyExtraction failed).
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
import type { ExtractedOrder } from '@/lib/email/extract/schema';

export interface EmailOrderBundle {
  order: {
    id: string;
    userId: string;
    merchantId: string | null;
    source: 'email';
    externalOrderNumber: string | null;
    orderDate: string;
    subtotalCents: number;
    taxCents: number;
    shippingCents: number;
    discountCents: number;
    totalCents: number;
    currency: string;
    needsReview: boolean;
  };
  orderItems: Array<{
    id: string;
    orderId: string;
    categoryId: string | null;
    name: string;
    variant: string | null;
    quantity: number;
    unitPriceCents: number;
    fingerprintStrict: string;
    fingerprintLoose: string;
  }>;
  inventoryItems: Array<{
    id: string;
    userId: string;
    orderItemId: string;
    categoryId: string | null;
    name: string;
    variant: string | null;
    fingerprintLoose: string;
    acquiredAt: string;
    costCents: number;
  }>;
  allocated: AllocatedUnit[];
  totals: OrderTotals;
}

export function buildEmailOrder(input: {
  userId: string;
  merchantId: string | null;
  merchantSlug: string | null;
  extraction: ExtractedOrder;
  needsReview?: boolean;
}): EmailOrderBundle {
  const { extraction } = input;
  for (const line of extraction.lines) {
    assertIntegerCents(line.unitPriceCents);
  }
  assertIntegerCents(extraction.taxCents);
  assertIntegerCents(extraction.shippingCents);
  assertIntegerCents(extraction.discountCents);
  assertIntegerCents(extraction.totalCents);

  const subtotalCents = orderSubtotalCents(extraction.lines);
  const totalCents = computeOrderTotalCents({
    subtotalCents,
    taxCents: extraction.taxCents,
    shippingCents: extraction.shippingCents,
    discountCents: extraction.discountCents,
  });

  const totals: OrderTotals = {
    subtotalCents,
    taxCents: extraction.taxCents,
    shippingCents: extraction.shippingCents,
    discountCents: extraction.discountCents,
    totalCents,
  };

  const slug = input.merchantSlug ?? extraction.merchantSlug ?? null;
  const orderId = randomUUID();
  const orderItems = extraction.lines.map((line) => {
    const fps = fingerprints({
      merchantSlug: slug,
      name: line.name,
      variant: line.variant,
    });
    return {
      id: randomUUID(),
      orderId,
      categoryId: null as string | null,
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

  const byId = new Map<string, (typeof orderItems)[number]>(
    orderItems.map((i) => [i.id, i]),
  );
  const inventoryItems = allocated.map((unit) => {
    const item = byId.get(unit.orderItemId);
    if (!item) throw new Error(`missing order item ${unit.orderItemId}`);
    return {
      id: randomUUID(),
      userId: input.userId,
      orderItemId: item.id,
      categoryId: item.categoryId,
      name: item.name,
      variant: item.variant,
      fingerprintLoose: item.fingerprintLoose,
      acquiredAt: extraction.orderDate,
      costCents: unit.costCents,
    };
  });

  return {
    order: {
      id: orderId,
      userId: input.userId,
      merchantId: input.merchantId,
      source: 'email',
      externalOrderNumber: extraction.externalOrderNumber ?? null,
      orderDate: extraction.orderDate,
      subtotalCents,
      taxCents: extraction.taxCents,
      shippingCents: extraction.shippingCents,
      discountCents: extraction.discountCents,
      totalCents: extraction.totalCents,
      currency: extraction.currency ?? 'USD',
      needsReview: Boolean(input.needsReview),
    },
    orderItems,
    inventoryItems,
    allocated,
    totals,
  };
}

import { reconcilesToTotal, type OrderTotals } from '@/lib/money';
import { extractedOrderSchema, type ExtractedOrder } from './schema';

export type ApplyExtractionResult =
  | { ok: true; order: ExtractedOrder; totals: OrderTotals }
  | { ok: false; reason: 'schema' | 'reconcile'; issues?: string[] };

/**
 * Validate LLM/heuristic JSON and apply the arithmetic gate.
 * Confidence never overrides a failed reconcile.
 */
export function applyExtraction(raw: unknown): ApplyExtractionResult {
  const parsed = extractedOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'schema',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  const order = parsed.data;
  const totals: OrderTotals = {
    subtotalCents: order.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0),
    taxCents: order.taxCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
  };

  if (
    !reconcilesToTotal(
      order.lines.map((l, index) => ({
        id: `line-${index}`,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
      })),
      totals,
    )
  ) {
    return { ok: false, reason: 'reconcile' };
  }

  return { ok: true, order, totals };
}

import {
  extractLifecycleFromEmail,
  type LifecycleExtraction,
} from '@/lib/email/extract/lifecycle';
import type { MessageClassification } from '@/lib/email/extract/schema';
import { SUGGESTABLE_CLASSIFICATIONS } from '@/lib/orders/suggest-for-email';

/**
 * Attaching a waiting shipping, delivery or return email to an order the
 * person picked in the review queue.
 *
 * The sync attaches these itself when it can find the order, and runs
 * applyLifecycleToOrder with what extractLifecycleFromEmail read from the
 * body. The review action does the same thing with the order the person
 * chose, so what lands on the order matches what the sync would have written.
 * The parts that do not need a database are here so they can be tested.
 */

/** The kinds of review email that can be attached to an existing order. */
export function isAttachableClassification(
  classification: string | null | undefined,
): classification is 'shipping' | 'delivery' | 'return' {
  return classification != null && SUGGESTABLE_CLASSIFICATIONS.has(classification);
}

/**
 * What to write onto the order for this email.
 *
 * The body comes from Gmail when it can be fetched. When it cannot (the grant
 * lapsed, or the message was deleted), the subject alone still says whether
 * the parcel shipped, arrived or went back, which is what moves the order's
 * status; only the tracking number and refund amount are lost.
 */
export function extractionForAttach(input: {
  classification: 'shipping' | 'delivery' | 'return';
  subject: string | null;
  body: { text: string; html: string | null } | null;
  receivedAt: Date | null;
}): LifecycleExtraction {
  const extraction = extractLifecycleFromEmail({
    classification: input.classification as MessageClassification,
    subject: input.subject ?? '',
    text: input.body?.text ?? '',
    html: input.body?.html ?? null,
    receivedAt: input.receivedAt,
  });
  // extractLifecycleFromEmail only returns null for other classifications.
  if (!extraction) {
    throw new Error(`Cannot attach a ${input.classification} email to an order.`);
  }
  return extraction;
}

/** The toast after an attach: what happened and to which order. */
export function attachedMessage(
  classification: 'shipping' | 'delivery' | 'return',
  order: { merchantName: string; orderDate: string },
): string {
  const what =
    classification === 'shipping'
      ? 'Shipping email'
      : classification === 'delivery'
        ? 'Delivery email'
        : 'Return email';
  return `${what} attached to the ${order.merchantName} order of ${order.orderDate}.`;
}

/** An order the queue's search can offer, in the shape the suggestions use. */
export type SearchableOrder = {
  orderId: string;
  merchantName: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  externalOrderNumber: string | null;
  totalCents: number;
  currency: string;
};

/**
 * The orders a typed query should offer, best first.
 *
 * Every whitespace-separated term has to appear in the merchant name, the
 * order number or the date, so "amazon 2026-08" narrows the way a person
 * expects. A term the merchant name starts with ranks above one it merely
 * contains; ties keep the order they came in, which is newest first.
 */
export function matchOrders(
  orders: readonly SearchableOrder[],
  query: string,
  limit = 8,
): SearchableOrder[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return orders.slice(0, limit);

  return orders
    .map((order, index) => {
      const merchant = order.merchantName.toLowerCase();
      const number = (order.externalOrderNumber ?? '').toLowerCase();
      const haystack = `${merchant} ${number} ${order.orderDate}`;
      if (!terms.every((term) => haystack.includes(term))) return null;
      const rank = terms.reduce(
        (total, term) =>
          total + (merchant.startsWith(term) || number.startsWith(term) ? 0 : 1),
        0,
      );
      return { order, rank, index };
    })
    .filter(
      (entry): entry is { order: SearchableOrder; rank: number; index: number } =>
        entry !== null,
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.order);
}

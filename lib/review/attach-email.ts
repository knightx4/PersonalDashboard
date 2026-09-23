import {
  extractLifecycleFromEmail,
  type LifecycleExtraction,
} from '@/lib/email/extract/lifecycle';
import type { MessageClassification } from '@/lib/email/extract/schema';
import { SUGGESTABLE_CLASSIFICATIONS } from '@/lib/orders/suggest-for-email';

/**
 * Attaching a waiting shipping, delivery, return or confirmation email to an
 * order the person picked in the review queue.
 *
 * The sync attaches these itself when it can find the order, and runs
 * applyLifecycleToOrder with what extractLifecycleFromEmail read from the
 * body. The review action does the same thing with the order the person
 * chose, so what lands on the order matches what the sync would have written.
 * The parts that do not need a database are here so they can be tested.
 */

/** A lifecycle email: what the sync applies to an order it finds. */
export type LifecycleAttachKind = 'shipping' | 'delivery' | 'return';

/** Every kind of review email that can be attached to an existing order. */
export type AttachableClassification = LifecycleAttachKind | 'order_confirmation';

/**
 * The kinds of review email that can be attached to an existing order.
 * Confirmations are included because most of the ones waiting in review are
 * shipping notices the classifier misread; see lifecycleKindForAttach.
 */
export function isAttachableClassification(
  classification: string | null | undefined,
): classification is AttachableClassification {
  return classification != null && SUGGESTABLE_CLASSIFICATIONS.has(classification);
}

const RETURN_SUBJECT = /\b(?:returns?|returned|refund|refunded|credited back)\b/i;
const DELIVERY_SUBJECT = /\b(?:delivered|has arrived|have arrived|delivery confirmation)\b/i;
const SHIPPING_SUBJECT =
  /\b(?:shipped|shipment|on the way|on its way|out for delivery|in transit|tracking|has your order|about to ship|delivery estimate)\b/i;

/**
 * What an attached email should be applied to the order as.
 *
 * A shipping, delivery or return email is applied as what it is. A
 * confirmation is read again from its subject, because the classifier checks
 * for "order #" before it checks for "on the way", so "A shipment from order
 * #11888 is on the way" arrives as a confirmation. When the subject reads as
 * none of the three (a pickup notice, a support thread, a ticket), the result
 * is null and the email is only linked to the order, with nothing applied.
 */
export function lifecycleKindForAttach(
  classification: AttachableClassification,
  subject: string | null,
): LifecycleAttachKind | null {
  if (classification !== 'order_confirmation') return classification;
  const text = subject ?? '';
  if (RETURN_SUBJECT.test(text)) return 'return';
  if (DELIVERY_SUBJECT.test(text)) return 'delivery';
  if (SHIPPING_SUBJECT.test(text)) return 'shipping';
  return null;
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
  classification: LifecycleAttachKind;
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

/**
 * The toast after an attach: what happened and to which order. A null kind is
 * an email that was only linked, with nothing applied.
 */
export function attachedMessage(
  classification: LifecycleAttachKind | null,
  order: { merchantName: string; orderDate: string },
): string {
  const what =
    classification === null
      ? 'Email'
      : classification === 'shipping'
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

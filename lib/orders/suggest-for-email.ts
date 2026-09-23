import { domainFromAddress } from '@/lib/email/extract/classify';
import { isSharedSenderDomain } from '@/lib/merchants/platform';

/**
 * Which orders a shipping, delivery or return email in the review queue
 * probably belongs to (or an order confirmation, which is often a shipping
 * notice the classifier misread), strongest first, each with the reason it was picked.
 *
 * The signals are the ones findOrderForLifecycleEmail uses at sync time, in
 * the same order: the email's Gmail thread already holds a message linked to
 * the order, then the order's number appears in the subject, then the email
 * comes from the order's merchant or from the domain its confirmation came
 * from, a short while after the order was placed. The sync stops at the first
 * hit; this keeps every order that scores and hands back the best three, so
 * the person picks rather than the code guessing.
 *
 * Nothing here is stored. The review loader works the candidates out on every
 * page load, as the jobs queue does with scoreCandidate in
 * lib/jobs/email/link.ts.
 */

/**
 * The review emails that get candidates. Confirmations are included because
 * most of the ones that wait in review are "on the way" and "out for delivery"
 * notices whose subject carries "order #", which the classifier reads as a
 * confirmation. A real confirmation still offers "Add from this email".
 */
export const SUGGESTABLE_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  'order_confirmation',
  'shipping',
  'delivery',
  'return',
]);

export const MAX_ORDER_CANDIDATES = 3;

/** How long after an order a merchant's email still counts as about it. */
export const MERCHANT_WINDOW_DAYS = 60;

/** Order numbers shorter than this match too much of an ordinary subject. */
const MIN_ORDER_NUMBER_LENGTH = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OrderCandidateSignal = 'thread' | 'order_number' | 'merchant';

export type OrderCandidate = {
  orderId: string;
  merchantName: string;
  /** YYYY-MM-DD, as stored on the order. */
  orderDate: string;
  externalOrderNumber: string | null;
  totalCents: number;
  currency: string;
  signal: OrderCandidateSignal;
  /** Short and lower case, for showing beside the order: "same thread". */
  reason: string;
  /** 0 to 1. Only the ordering means anything. */
  score: number;
};

export type SuggestEmail = {
  /** The review email's own id, so its own link is not counted as thread evidence. */
  messageId: string;
  threadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  replyToAddress: string | null;
  receivedAt: string | null;
};

export type SuggestOrder = {
  id: string;
  merchantName: string;
  merchantDomains: readonly string[];
  orderDate: string;
  externalOrderNumber: string | null;
  totalCents: number;
  currency: string;
};

/** A message already linked to an order: its thread and its sender. */
export type LinkedMessage = {
  messageId: string;
  orderId: string;
  threadId: string | null;
  fromAddress: string | null;
  replyToAddress: string | null;
};

/** What each order is known by, built once per page load from its linked messages. */
export type OrderEvidence = {
  threadIds: Set<string>;
  /** Sender domains of the order's own emails, shared platforms left out. */
  senderDomains: Set<string>;
  /** Which message ids gave those threads, so an email is not its own evidence. */
  messageIdsByThread: Map<string, Set<string>>;
};

export function buildOrderEvidence(
  linked: readonly LinkedMessage[],
): Map<string, OrderEvidence> {
  const byOrder = new Map<string, OrderEvidence>();
  for (const message of linked) {
    let evidence = byOrder.get(message.orderId);
    if (!evidence) {
      evidence = { threadIds: new Set(), senderDomains: new Set(), messageIdsByThread: new Map() };
      byOrder.set(message.orderId, evidence);
    }
    if (message.threadId) {
      evidence.threadIds.add(message.threadId);
      const ids = evidence.messageIdsByThread.get(message.threadId) ?? new Set<string>();
      ids.add(message.messageId);
      evidence.messageIdsByThread.set(message.threadId, ids);
    }
    for (const domain of ownDomains(message.fromAddress, message.replyToAddress)) {
      evidence.senderDomains.add(domain);
    }
  }
  return byOrder;
}

/** From and Reply-To domains, leaving out ones many shops send from. */
function ownDomains(fromAddress: string | null, replyToAddress: string | null): string[] {
  const out: string[] = [];
  for (const domain of [domainFromAddress(replyToAddress), domainFromAddress(fromAddress)]) {
    if (domain && !isSharedSenderDomain(domain) && !out.includes(domain)) out.push(domain);
  }
  return out;
}

/** Either domain is the other or a subdomain of it: email.shop.com and shop.com match. */
function sameDomain(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/** The order number appears in the subject as a whole token, ignoring case. */
export function subjectHasOrderNumber(
  subject: string | null,
  orderNumber: string | null,
): boolean {
  if (!subject || !orderNumber) return false;
  const needle = orderNumber.trim().replace(/^#/, '').toLowerCase();
  if (needle.length < MIN_ORDER_NUMBER_LENGTH || !/\d/.test(needle)) return false;
  const haystack = subject.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at > 0 ? haystack[at - 1] : '';
    const after = haystack[at + needle.length] ?? '';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/** Whole days from the order date to the email, negative when the order is later. */
function daysAfterOrder(orderDate: string, receivedAt: string): number | null {
  const ordered = Date.parse(`${orderDate.slice(0, 10)}T00:00:00Z`);
  const received = Date.parse(receivedAt);
  if (Number.isNaN(ordered) || Number.isNaN(received)) return null;
  const receivedDay = Date.parse(`${new Date(received).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((receivedDay - ordered) / DAY_MS);
}

function daysPhrase(days: number): string {
  if (days <= 0) return 'ordered the same day';
  if (days === 1) return 'ordered 1 day before';
  return `ordered ${days} days before`;
}

/**
 * The strongest signal tying one order to one email, or null when none does.
 * Thread beats order number beats merchant, whatever the dates say.
 */
export function scoreOrderCandidate(
  email: SuggestEmail,
  order: SuggestOrder,
  evidence: OrderEvidence | undefined,
): OrderCandidate | null {
  const base = {
    orderId: order.id,
    merchantName: order.merchantName,
    orderDate: order.orderDate,
    externalOrderNumber: order.externalOrderNumber,
    totalCents: order.totalCents,
    currency: order.currency,
  };

  // 1. Same Gmail thread as a message already linked to this order. A thread
  //    that holds only this email itself says nothing.
  if (email.threadId && evidence?.threadIds.has(email.threadId)) {
    const ids = evidence.messageIdsByThread.get(email.threadId);
    const others = ids ? [...ids].filter((id) => id !== email.messageId) : [];
    if (others.length > 0) {
      return { ...base, signal: 'thread', reason: 'same thread', score: 1 };
    }
  }

  // 2. The order's number is in the subject. Bodies are not kept, so the
  //    subject is the only text of the email there is to look in.
  if (subjectHasOrderNumber(email.subject, order.externalOrderNumber)) {
    return {
      ...base,
      signal: 'order_number',
      reason: `order number ${order.externalOrderNumber!.trim()}`,
      score: 0.9,
    };
  }

  // 3. Same merchant or sender domain, with the order placed shortly before.
  if (!email.receivedAt) return null;
  const emailDomains = ownDomains(email.fromAddress, email.replyToAddress);
  if (emailDomains.length === 0) return null;

  const merchantHit = emailDomains.some((domain) =>
    order.merchantDomains.some((merchantDomain) => sameDomain(domain, merchantDomain)),
  );
  const senderHit =
    !merchantHit &&
    emailDomains.some((domain) =>
      [...(evidence?.senderDomains ?? [])].some((known) => sameDomain(domain, known)),
    );
  if (!merchantHit && !senderHit) return null;

  const days = daysAfterOrder(order.orderDate, email.receivedAt);
  // A day's grace for an order dated in another time zone than the email.
  if (days === null || days < -1 || days > MERCHANT_WINDOW_DAYS) return null;

  // Nearer orders score higher, between 0.4 and 0.7; always below a number.
  const nearness = 1 - Math.max(0, days) / MERCHANT_WINDOW_DAYS;
  const who = merchantHit ? 'same merchant' : 'same sender';
  return {
    ...base,
    signal: 'merchant',
    reason: `${who}, ${daysPhrase(days)}`,
    score: 0.4 + 0.3 * nearness,
  };
}

/**
 * The best orders for one email, strongest first, at most three. Ties go to
 * the more recent order, which is the one a new shipping email is likelier to
 * be about.
 */
export function suggestOrdersForEmail(
  email: SuggestEmail,
  orders: readonly SuggestOrder[],
  evidenceByOrder: ReadonlyMap<string, OrderEvidence>,
  limit = MAX_ORDER_CANDIDATES,
): OrderCandidate[] {
  const scored: OrderCandidate[] = [];
  for (const order of orders) {
    const hit = scoreOrderCandidate(email, order, evidenceByOrder.get(order.id));
    if (hit) scored.push(hit);
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.orderDate.localeCompare(a.orderDate);
  });
  return scored.slice(0, limit);
}

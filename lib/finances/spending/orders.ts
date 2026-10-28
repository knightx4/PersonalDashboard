import { daysBetween } from './internal';
import type { MatchOrder, SpendTransaction } from './types';

/**
 * Tying a charge to the Shopping order it paid for (plan #2593.7), so the
 * order opens from the charge. A charge matches an order of the same total
 * whose merchant reads the same, placed up to a day after the charge posted
 * (a pending charge settling early) or up to ORDER_WINDOW_DAYS before it
 * (shipping first, charging later). Each order pays for one charge; when two
 * charges could take one order, the nearer in time does.
 *
 * A charge whose row already names an order keeps it.
 */

export const ORDER_WINDOW_DAYS = 10;

/** Words a statement adds to a merchant's name that say nothing about which merchant. */
const NOISE = new Set([
  'the', 'inc', 'llc', 'ltd', 'co', 'corp', 'com', 'www', 'store', 'online', 'mktp', 'mktpl',
  'marketplace', 'pos', 'debit', 'purchase', 'sq', 'tst', 'us', 'usa',
]);

/** A merchant's name as a key: lower case, letters and digits, noise words gone. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.com\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 1 && !NOISE.has(word) && !/^\d+$/.test(word))
    .join(' ')
    .trim();
}

/** Whether two names read as the same merchant. */
export function sameMerchant(a: string, b: string): boolean {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (!ka || !kb) return false;
  const squashedA = ka.replace(/ /g, '');
  const squashedB = kb.replace(/ /g, '');
  if (squashedA.includes(squashedB) || squashedB.includes(squashedA)) return true;
  const firstA = ka.split(' ')[0];
  const firstB = kb.split(' ')[0];
  return firstA.length >= 4 && firstA === firstB;
}

/**
 * The order each charge paid for, by transaction id. Only charges (money
 * out) are matched, and only against orders that were not cancelled.
 */
export function matchOrders(
  charges: readonly SpendTransaction[],
  orders: readonly MatchOrder[],
): Map<string, string> {
  const matched = new Map<string, string>();
  const taken = new Set<string>();

  for (const t of charges) {
    if (t.orderId) {
      matched.set(t.id, t.orderId);
      taken.add(t.orderId);
    }
  }

  type Candidate = { chargeId: string; orderId: string; gap: number };
  const candidates: Candidate[] = [];
  for (const t of charges) {
    if (t.orderId || t.amountCents >= 0) continue;
    const name = t.merchant ?? t.description;
    for (const order of orders) {
      if (order.cancelled || taken.has(order.id) || order.totalCents !== -t.amountCents) continue;
      const after = daysBetween(order.orderDate, t.postedOn);
      if (after < -1 || after > ORDER_WINDOW_DAYS) continue;
      if (!order.merchantName || !sameMerchant(name, order.merchantName)) continue;
      candidates.push({ chargeId: t.id, orderId: order.id, gap: Math.abs(after) });
    }
  }

  candidates.sort(
    (a, b) => a.gap - b.gap || a.chargeId.localeCompare(b.chargeId) || a.orderId.localeCompare(b.orderId),
  );
  for (const c of candidates) {
    if (matched.has(c.chargeId) || taken.has(c.orderId)) continue;
    matched.set(c.chargeId, c.orderId);
    taken.add(c.orderId);
  }
  return matched;
}

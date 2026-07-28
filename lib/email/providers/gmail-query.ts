/**
 * Gmail search for likely purchase mail within the backfill window.
 *
 * Require order-ish subjects. Bare `from:amazon.com` alone pulls marketing
 * noise and left the sync skipping everything. Exact phrases like
 * "your order of" are intentionally avoided — they miss "Your Amazon.com order of …".
 */
export function orderCandidateQuery(backfillWindowDays: number): string {
  const days = Math.min(730, Math.max(30, backfillWindowDays));
  const subjects = [
    'subject:order',
    'subject:ordered',
    'subject:shipment',
    'subject:shipped',
    'subject:delivery',
    'subject:delivered',
    'subject:invoice',
    'subject:receipt',
    'subject:refund',
    'subject:return',
  ].join(' OR ');
  return `newer_than:${days}d (${subjects})`;
}

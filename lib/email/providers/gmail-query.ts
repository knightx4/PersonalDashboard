/**
 * Gmail search for likely purchase mail within the backfill window.
 *
 * Require order-ish subjects. Bare `from:amazon.com` alone pulls marketing
 * noise and left the sync skipping everything. Exact phrases like
 * "your order of" are intentionally avoided — they miss "Your Amazon.com order of …".
 */
/**
 * The commerce half of the search vocabulary.
 *
 * Exported because one sync now serves both workspaces and has to ask for the
 * union of what each wants -- but the terms stay owned here, so adding a
 * merchant keyword does not mean editing a shared file.
 */
export const ORDER_SUBJECT_TERMS: readonly string[] = [
  'order',
  'ordered',
  'shipment',
  'shipped',
  'delivery',
  'delivered',
  'invoice',
  'receipt',
  'refund',
  'return',
];

export function orderCandidateQuery(backfillWindowDays: number): string {
  const days = Math.min(730, Math.max(30, backfillWindowDays));
  const subjects = ORDER_SUBJECT_TERMS.map((t) => `subject:${t}`).join(' OR ');
  return `newer_than:${days}d (${subjects})`;
}

/** Gmail search for a bounded catch-up when historyId is expired. */
export function incrementalFallbackQuery(lastSyncedAt: string | null, now = new Date()): string {
  const fallbackDays = 7;
  let days = fallbackDays;
  if (lastSyncedAt) {
    const synced = new Date(lastSyncedAt);
    if (Number.isFinite(synced.getTime())) {
      const elapsedDays = Math.ceil((now.getTime() - synced.getTime()) / (24 * 60 * 60 * 1000));
      // One extra day of cushion; clamp to a sane window.
      days = Math.min(30, Math.max(fallbackDays, elapsedDays + 1));
    }
  }
  return orderCandidateQuery(days);
}

/**
 * Gmail search for likely purchase mail within the backfill window.
 *
 * Keep this broad: exact subject phrases like "your order of" miss real Amazon
 * subjects ("Your Amazon.com order of …") because of words in between. Tier A
 * classification still discards non-order mail after fetch.
 */
export function orderCandidateQuery(backfillWindowDays: number): string {
  const days = Math.min(730, Math.max(30, backfillWindowDays));
  return [
    `newer_than:${days}d`,
    '(',
    [
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
      'from:amazon.com',
      'from:order-update.amazon.com',
      'from:marketplace.amazon.com',
      'from:target.com',
      'from:walmart.com',
      'from:bestbuy.com',
      'from:apple.com',
      'from:nike.com',
      'from:ebay.com',
      'from:etsy.com',
      'from:paypal.com',
      'from:shopify.com',
    ].join(' OR '),
    ')',
  ].join(' ');
}

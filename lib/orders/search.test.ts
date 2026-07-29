import { describe, expect, it } from 'vitest';
import {
  matchingItemHint,
  orderMatchesQuery,
  sanitizeOrdersQuery,
} from '@/lib/orders/search';

describe('orders search', () => {
  const order = {
    status: 'delivered',
    external_order_number: '114-1276134-9911401',
    merchants: { name: 'Amazon' },
    order_items: [{ name: 'The Well-Tempered City', variant: null }],
    ingested_messages: [
      { subject: 'Ordered: "The Well-Tempered City:..."', from_address: 'auto-confirm@amazon.com' },
    ],
  };

  it('sanitizes wildcard characters', () => {
    expect(sanitizeOrdersQuery('  well%tempered_*  ')).toBe('well tempered');
  });

  it('matches merchant, item, order number, and subject', () => {
    expect(orderMatchesQuery(order, 'amazon')).toBe(true);
    expect(orderMatchesQuery(order, 'well-tempered')).toBe(true);
    expect(orderMatchesQuery(order, '114-1276134')).toBe(true);
    expect(orderMatchesQuery(order, 'ordered:')).toBe(true);
    expect(orderMatchesQuery(order, 'nike')).toBe(false);
  });

  it('returns a matching line hint', () => {
    expect(matchingItemHint(order, 'tempered')).toBe('The Well-Tempered City');
  });
});

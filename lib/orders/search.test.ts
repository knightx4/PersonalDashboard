import { describe, expect, it } from 'vitest';
import {
  matchingItemHint,
  orderItemsSummary,
  orderMatchesQuery,
  sanitizeOrdersQuery,
  shortItemLabel,
} from '@/lib/orders/search';

describe('orders search', () => {
  const order = {
    status: 'delivered',
    external_order_number: '114-1276134-9911401',
    merchants: { name: 'Amazon' },
    order_items: [{ name: 'The Well-Tempered City', variant: null, quantity: 1 }],
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

describe('orderItemsSummary', () => {
  it('summarizes a single item', () => {
    const summary = orderItemsSummary({
      order_items: [
        {
          name: 'The Well-Tempered City: What Modern Science',
          variant: 'Paperback',
          quantity: 1,
          categories: { name: 'Books' },
        },
      ],
    });
    expect(summary.itemCount).toBe(1);
    expect(summary.label).toBe(
      '1 item · Books · The Well-Tempered City: What Modern Science',
    );
  });

  it('counts units and lists short multi-item names', () => {
    const summary = orderItemsSummary({
      order_items: [
        {
          name: 'Legacy NCAA Officially Licensed Baseball Hat, NYU Violets, Lightweight Cap',
          variant: null,
          quantity: 1,
          categories: { name: 'Clothing' },
        },
        {
          name: 'New York University Official Distressed Primary Logo Unisex Adult T Shirt,Athletic Heather, Small',
          variant: null,
          quantity: 2,
          categories: { name: 'Clothing' },
        },
      ],
    });
    expect(summary.itemCount).toBe(3);
    expect(summary.lineCount).toBe(2);
    expect(summary.label).toContain('3 items');
    expect(summary.label).toContain('Clothing');
    expect(summary.label).toContain('Legacy NCAA Officially Licensed Baseball Hat');
    expect(summary.label).toContain('New York University Official Distressed');
  });

  it('shortens long titles at a comma when useful', () => {
    expect(
      shortItemLabel(
        'Legacy NCAA Officially Licensed Baseball Hat, NYU Violets, Lightweight Cap',
      ),
    ).toBe('Legacy NCAA Officially Licensed Baseball Hat');
  });
});

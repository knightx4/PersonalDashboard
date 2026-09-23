import { describe, expect, it } from 'vitest';
import { draftFromExtraction, summarizeReads, type ReadOutcome } from './read-order';

const merchants = [
  { id: 'm-target', slug: 'target', name: 'Target', domains: ['target.com'] },
  { id: 'm-shopify', slug: 'shopify', name: 'Shopify', domains: ['shopifyemail.com'] },
];
const categoryIdsBySlug = new Map([['kitchen', 'c-kitchen']]);

const email = {
  subject: 'Your order #AB12345 is confirmed',
  text: 'Thanks for shopping.',
  fromAddress: '"Goods of Desire" <store+123@shopifyemail.com>',
  date: new Date('2026-09-20T02:00:00Z'),
};

const order = {
  merchantName: 'Goods of Desire',
  externalOrderNumber: 'GOD-1001',
  orderDate: '2026-09-19',
  currency: 'HKD',
  taxCents: 0,
  shippingCents: 500,
  discountCents: 0,
  totalCents: 2500,
  lines: [
    { name: 'Tea towel', variant: 'Blue', quantity: 2, unitPriceCents: 1000, categorySlug: 'kitchen' },
  ],
};

function base(extraction: Parameters<typeof draftFromExtraction>[0]['extraction']) {
  return draftFromExtraction({
    extraction,
    email,
    merchants,
    categoryIdsBySlug,
    timezone: 'Asia/Hong_Kong',
  });
}

describe('draftFromExtraction', () => {
  it('takes a read that reconciled as it is', () => {
    const draft = base({
      result: { ok: true, order, totals: { subtotalCents: 2000, taxCents: 0, shippingCents: 500, discountCents: 0, totalCents: 2500 } },
      source: 'llm',
    });
    expect(draft).toMatchObject({
      merchantId: null,
      merchantName: 'Goods of Desire',
      orderDate: '2026-09-19',
      externalOrderNumber: 'GOD-1001',
      currency: 'HKD',
      shippingCents: 500,
      totalCents: 2500,
      reconciled: true,
      source: 'llm',
      issues: [],
    });
    expect(draft.lines).toEqual([
      { name: 'Tea towel', variant: 'Blue', quantity: 2, unitPriceCents: 1000, categoryId: 'c-kitchen' },
    ]);
  });

  it('keeps the lines of a read that did not add up, marked unchecked', () => {
    const draft = base({
      result: { ok: false, reason: 'reconcile' },
      source: 'heuristic',
      raw: { ...order, totalCents: 9999 },
    });
    expect(draft.lines).toHaveLength(1);
    expect(draft.reconciled).toBe(false);
    expect(draft.issues).toEqual(['reconcile']);
    expect(draft.totalCents).toBe(9999);
  });

  it('keeps each line that passes on its own when the order as a whole failed', () => {
    const draft = base({
      result: { ok: false, reason: 'schema', issues: ['Required'] },
      source: 'heuristic',
      raw: { lines: [order.lines[0], { name: '', quantity: 0 }], orderDate: 'yesterday' },
    });
    expect(draft.lines.map((line) => line.name)).toEqual(['Tea towel']);
    expect(draft.issues).toEqual(['Required']);
    // A date that is not YYYY-MM-DD falls back to the email's own date.
    expect(draft.orderDate).toBe('2026-09-20');
  });

  it('fills merchant, date and order number from the email when nothing was read', () => {
    const draft = base({
      result: { ok: false, reason: 'schema', issues: ['no_extraction'] },
      source: 'heuristic',
    });
    expect(draft).toMatchObject({
      merchantId: null,
      merchantName: 'Goods of Desire',
      // 02:00 UTC on the 20th is the 20th in Hong Kong.
      orderDate: '2026-09-20',
      externalOrderNumber: 'AB12345',
      lines: [],
      totalCents: null,
      reconciled: false,
      source: 'none',
      issues: ['no_extraction'],
    });
  });

  it('names a known merchant by id from the sender domain, never the platform relay', () => {
    const known = draftFromExtraction({
      extraction: null,
      email: { ...email, fromAddress: 'orders@e.target.com' },
      merchants,
      categoryIdsBySlug,
      timezone: 'UTC',
    });
    expect(known.merchantId).toBe('m-target');
    expect(known.merchantName).toBe('Target');

    const relay = draftFromExtraction({
      extraction: null,
      email: { ...email, fromAddress: 'store+123@shopifyemail.com' },
      merchants,
      categoryIdsBySlug,
      timezone: 'UTC',
    });
    expect(relay.merchantId).toBeNull();
    expect(relay.merchantName).toBe('store+123@shopifyemail.com');
  });
});

describe('summarizeReads', () => {
  it('counts drafts with items, the reconciled ones, and why reads were refused', () => {
    const draft = base({ result: { ok: false, reason: 'schema', issues: ['no_extraction'] }, source: 'heuristic' });
    const withItems = base({ result: { ok: false, reason: 'reconcile' }, source: 'heuristic', raw: order });
    const outcomes: ReadOutcome[] = [
      { messageId: '1', subject: null, ok: true, draft },
      { messageId: '2', subject: null, ok: true, draft },
      { messageId: '3', subject: null, ok: true, draft: withItems },
      { messageId: '4', subject: null, ok: false, error: 'Gmail fetch failed.' },
    ];
    expect(summarizeReads(outcomes)).toEqual({
      total: 4,
      withItems: 1,
      reconciled: 0,
      withoutItems: 2,
      failed: 1,
      issues: [
        { issue: 'no_extraction', count: 2 },
        { issue: 'reconcile', count: 1 },
      ],
    });
  });
});

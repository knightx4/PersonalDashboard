import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyExtraction } from './apply';
import { classifyMessage } from './classify';
import { heuristicExtractOrder } from './heuristic';

const amazonFixture = readFileSync(
  resolve(__dirname, '../../../fixtures/emails/amazon-order-confirmation.txt'),
  'utf8',
);

describe('classifyMessage', () => {
  const amazon = {
    id: 'm1',
    slug: 'amazon',
    name: 'Amazon',
    domains: ['amazon.com', 'order-update.amazon.com'],
  };

  it('marks known-merchant order subjects as order_confirmation', () => {
    const result = classifyMessage({
      fromAddress: 'auto-confirm@amazon.com',
      subject: 'Your Amazon.com order of Headphones',
      merchants: [amazon],
    });
    expect(result.classification).toBe('order_confirmation');
    expect(result.merchant?.slug).toBe('amazon');
    expect(result.tier).toBe('A');
  });

  it('matches Amazon order subjects via ORDER_SUBJECT without relying on merchant', () => {
    const result = classifyMessage({
      fromAddress: 'ship-confirm@amazon.com',
      subject: 'Your Amazon.com order of USB-C Hub',
      merchants: [],
    });
    expect(result.classification).toBe('order_confirmation');
  });

  it('marks Amazon review prompts as not_relevant', () => {
    const result = classifyMessage({
      fromAddress: 'no-reply@amazon.com',
      subject: 'Did your recent Amazon order meet your expectations? Review it on Amazon',
      merchants: [amazon],
    });
    expect(result.classification).toBe('not_relevant');
  });

  it('marks unknown personal mail as not_relevant', () => {
    const result = classifyMessage({
      fromAddress: 'friend@gmail.com',
      subject: 'Dinner plans?',
      merchants: [amazon],
    });
    expect(result.classification).toBe('not_relevant');
  });
});

describe('heuristicExtractOrder + applyExtraction', () => {
  it('extracts the Amazon fixture and reconciles', () => {
    const firstLine = amazonFixture.split('\n')[0] ?? '';
    const subject = firstLine.replace(/^Subject:\s*/i, '');
    const body = amazonFixture.replace(/^Subject:.*\n\n?/, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      merchantSlug: 'amazon',
      merchantName: 'Amazon',
      receivedAt: new Date('2026-01-15T12:00:00Z'),
    });
    expect(raw).not.toBeNull();
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.order.externalOrderNumber).toBe('123-4567890-1234567');
      expect(applied.order.totalCents).toBe(37584);
      expect(applied.order.lines[0]?.name).toMatch(/Sony/i);
    }
  });

  it('names DoorDash-style orders from the subject when line items are missing', () => {
    const raw = heuristicExtractOrder({
      subject: 'Your order from bb.q Chicken (order #350db292)',
      text: 'Thanks for ordering.\nTotal: $4.39\n',
      merchantSlug: 'doordash',
      merchantName: 'DoorDash',
      fromAddress: '"bb.q Chicken" <noreply@order.online>',
      receivedAt: new Date('2026-06-17T12:00:00Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.externalOrderNumber).toBe('350db292');
    expect(raw?.lines[0]?.name).toMatch(/bb\.q Chicken/i);
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('rejects extractions totals that do not reconcile', () => {
    const applied = applyExtraction({
      merchantSlug: 'amazon',
      orderDate: '2026-01-15',
      taxCents: 0,
      shippingCents: 0,
      discountCents: 0,
      totalCents: 99999,
      lines: [{ name: 'Widget', quantity: 1, unitPriceCents: 100 }],
    });
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.reason).toBe('reconcile');
  });
});

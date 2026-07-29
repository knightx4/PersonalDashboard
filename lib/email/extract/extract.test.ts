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

  it('marks Amazon Ordered: title subjects as order_confirmation', () => {
    const result = classifyMessage({
      fromAddress: 'Amazon.com <auto-confirm@amazon.com>',
      subject: 'Ordered: "The Well-Tempered City:..."',
      merchants: [amazon],
    });
    expect(result.classification).toBe('order_confirmation');
    expect(result.merchant?.slug).toBe('amazon');
  });

  it('marks Shopify-style Order N confirmed subjects as order_confirmation', () => {
    const result = classifyMessage({
      fromAddress: 'Ms Betters <hello@msbetters.us>',
      subject: 'Order 5781 confirmed',
      merchants: [],
    });
    expect(result.classification).toBe('order_confirmation');
    expect(result.merchant).toBeNull();
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

  it('parses Amazon Ordered: subjects with Grand Total in USD', () => {
    const raw = heuristicExtractOrder({
      subject: 'Ordered: "The Well-Tempered City:..."',
      text: [
        'Thanks for your order!',
        'Order #',
        '114-1276134-9911401',
        '* The Well-Tempered City: What Modern Science',
        '  Paperback',
        '  Quantity: 1',
        '  15.19 USD',
        'Grand Total:',
        '16.15 USD',
      ].join('\n'),
      merchantSlug: 'amazon',
      merchantName: 'Amazon',
      fromAddress: '"Amazon.com" <auto-confirm@amazon.com>',
      receivedAt: new Date('2026-06-11T02:53:10Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.externalOrderNumber).toBe('114-1276134-9911401');
    expect(raw?.totalCents).toBe(1615);
    expect(raw?.taxCents).toBe(96);
    expect(raw?.lines).toHaveLength(1);
    expect(raw?.lines[0]?.name).toMatch(/Well-Tempered City/i);
    expect(raw?.lines[0]?.unitPriceCents).toBe(1519);
    expect(raw?.lines[0]?.categorySlug).toBe('books');
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('parses Amazon multi-item Ordered: confirmations into separate lines', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../../../fixtures/emails/amazon-multi-item-ordered.txt'),
      'utf8',
    );
    const subject = (fixture.split('\n')[0] ?? '').replace(/^Subject:\s*/i, '');
    const body = fixture.replace(/^Subject:.*\n\n?/, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      merchantSlug: 'amazon',
      merchantName: 'Amazon',
      fromAddress: '"Amazon.com" <auto-confirm@amazon.com>',
      receivedAt: new Date('2026-03-30T04:37:57Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.externalOrderNumber).toBe('114-9014714-4960229');
    expect(raw?.totalCents).toBe(4996);
    expect(raw?.taxCents).toBe(298);
    expect(raw?.lines).toHaveLength(2);
    expect(raw?.lines[0]?.name).toMatch(/Baseball Hat/i);
    expect(raw?.lines[0]?.unitPriceCents).toBe(2699);
    expect(raw?.lines[0]?.categorySlug).toBe('clothing');
    expect(raw?.lines[1]?.name).toMatch(/T Shirt/i);
    expect(raw?.lines[1]?.unitPriceCents).toBe(1999);
    expect(raw?.lines[1]?.categorySlug).toBe('clothing');
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('parses Shopify Order confirmed emails with store From + product × qty', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../../../fixtures/emails/shopify-ms-betters-order.txt'),
      'utf8',
    );
    const subject = (fixture.match(/^Subject:\s*(.*)$/im)?.[1] ?? '').trim();
    const from = (fixture.match(/^From:\s*(.*)$/im)?.[1] ?? '').trim();
    const body = fixture.replace(/^Subject:.*\nFrom:.*\n\n?/i, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      fromAddress: from,
      receivedAt: new Date('2026-04-01T12:00:00Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.merchantName).toMatch(/Ms Betters/i);
    expect(raw?.externalOrderNumber).toBe('5781');
    expect(raw?.totalCents).toBe(3999);
    expect(raw?.shippingCents).toBe(799);
    expect(raw?.lines).toHaveLength(1);
    expect(raw?.lines[0]?.name).toMatch(/Miraculous Foamer/i);
    expect(raw?.lines[0]?.variant).toMatch(/4 oz/i);
    expect(raw?.lines[0]?.unitPriceCents).toBe(3200);
    expect(raw?.lines[0]?.quantity).toBe(1);
    expect(raw?.lines[0]?.categorySlug).toBe('beauty');
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

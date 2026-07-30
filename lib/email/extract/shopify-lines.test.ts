import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyExtraction } from './apply';
import { heuristicExtractOrder } from './heuristic';
import { parseShopifyQuantityLines } from './shopify-lines';

describe('parseShopifyQuantityLines', () => {
  it('reads product × qty, variant, and dollar price from an order summary', () => {
    const text = `
Order summary
-------------

Miraculous Foamer × 1

4 oz

$32.00

Subtotal

$32.00

Shipping

$7.99

Taxes

$0.00

Total

$39.99 USD

Customer information
--------------------
`;
    const lines = parseShopifyQuantityLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: 'Miraculous Foamer',
      quantity: 1,
      unitPriceCents: 3200,
      variant: '4 oz',
    });
  });

  it('allows Kickstarter-style attribute lines before the price', () => {
    const text = `
Order summary
-------------

Your Pandora's Legacy Pledge - 3 × 1

The Ultimate Bundle

_Kickstarter:

Pledge

$99.00

Subtotal

$99.00

Shipping

$17.00

Total

$116.00 USD

Customer information
--------------------
`;
    const lines = parseShopifyQuantityLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.name).toBe("Your Pandora's Legacy Pledge - 3");
    expect(lines[0]?.quantity).toBe(1);
    expect(lines[0]?.unitPriceCents).toBe(9900);
    expect(lines[0]?.variant).toMatch(/Ultimate Bundle/i);
    expect(lines[0]?.variant).toMatch(/Kickstarter/i);
  });
});

describe('heuristicExtractOrder Allplay fixture', () => {
  it('extracts the pledge line instead of a generic merchant fallback', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../../../fixtures/emails/shopify-allplay-order.txt'),
      'utf8',
    );
    const subject = (fixture.split('\n')[0] ?? '').replace(/^Subject:\s*/i, '');
    const body = fixture.replace(/^Subject:.*\nFrom:.*\n\n?/, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      merchantName: 'Allplay',
      fromAddress: 'Allplay <help@allplay.com>',
      receivedAt: new Date('2026-05-22T13:59:33Z'),
    });
    expect(raw).not.toBeNull();
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.order.externalOrderNumber).toBe('431949');
      expect(applied.order.totalCents).toBe(11600);
      expect(applied.order.shippingCents).toBe(1700);
      expect(applied.order.lines).toHaveLength(1);
      expect(applied.order.lines[0]?.name).toMatch(/Pandora/i);
      expect(applied.order.lines[0]?.unitPriceCents).toBe(9900);
      expect(applied.order.lines[0]?.name).not.toMatch(/^Allplay order$/i);
    }
  });
});

describe('heuristicExtractOrder Goods of Desire fixture', () => {
  it('reads boutique merchant, SKU line item, and HKD totals (not Shopify/USD)', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../../../fixtures/emails/shopify-goods-of-desire-order.txt'),
      'utf8',
    );
    const subject = (fixture.split('\n')[0] ?? '').replace(/^Subject:\s*/i, '');
    const body = fixture.replace(/^Subject:.*\nFrom:.*\n\n?/, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      merchantSlug: 'shopify',
      merchantName: 'Shopify',
      fromAddress: 'Goods of Desire <store+7386935@t.shopifyemail.com>',
      receivedAt: new Date('2026-05-22T04:20:32Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.merchantName).toMatch(/Goods of Desire/i);
    expect(raw?.merchantSlug).toBeNull();
    expect(raw?.currency).toBe('HKD');
    expect(raw?.totalCents).toBe(39633);
    expect(raw?.shippingCents).toBe(21633);
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.order.externalOrderNumber).toBe('11888');
      expect(applied.order.currency).toBe('HKD');
      expect(applied.order.lines).toHaveLength(1);
      expect(applied.order.lines[0]?.name).toMatch(/Mahjong/i);
      expect(applied.order.lines[0]?.quantity).toBe(1);
      expect(applied.order.lines[0]?.unitPriceCents).toBe(18000);
      expect(applied.order.lines[0]?.name).not.toMatch(/Shopify/i);
    }
  });
});

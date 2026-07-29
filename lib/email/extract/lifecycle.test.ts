import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyMessage } from './classify';
import { extractLifecycleFromEmail } from './lifecycle';

const amazon = {
  id: 'm1',
  slug: 'amazon',
  name: 'Amazon',
  domains: ['amazon.com', 'order-update.amazon.com'],
};

function loadFixture(name: string) {
  const raw = readFileSync(resolve(__dirname, `../../../fixtures/emails/${name}`), 'utf8');
  const subject = (raw.split('\n')[0] ?? '').replace(/^Subject:\s*/i, '');
  const text = raw.replace(/^Subject:.*\n\n?/, '');
  return { subject, text };
}

describe('classifyMessage lifecycle', () => {
  it('marks shipped subjects as shipping', () => {
    const result = classifyMessage({
      fromAddress: 'shipment-tracking@amazon.com',
      subject: 'Your Amazon.com package has shipped',
      merchants: [amazon],
    });
    expect(result.classification).toBe('shipping');
  });

  it('marks delivered subjects as delivery', () => {
    const result = classifyMessage({
      fromAddress: 'shipment-tracking@amazon.com',
      subject: 'Your Amazon.com package was delivered',
      merchants: [amazon],
    });
    expect(result.classification).toBe('delivery');
  });

  it('marks refund subjects as return', () => {
    const result = classifyMessage({
      fromAddress: 'auto-confirm@amazon.com',
      subject: 'Your refund for Sony WH-1000XM5 Wireless Headphones',
      merchants: [amazon],
    });
    expect(result.classification).toBe('return');
  });

  it('marks cancellation subjects as cancellation', () => {
    const result = classifyMessage({
      fromAddress: 'auto-confirm@amazon.com',
      subject: 'Your Amazon.com order has been cancelled',
      merchants: [amazon],
    });
    expect(result.classification).toBe('cancellation');
  });
});

describe('extractLifecycleFromEmail', () => {
  it('extracts shipping details from the Amazon fixture', () => {
    const { subject, text } = loadFixture('amazon-shipped.txt');
    const extracted = extractLifecycleFromEmail({
      classification: 'shipping',
      subject,
      text,
      receivedAt: new Date('2026-01-16T15:00:00Z'),
    });
    expect(extracted).not.toBeNull();
    expect(extracted?.externalOrderNumber).toBe('123-4567890-1234567');
    expect(extracted?.trackingNumber).toBe('TBA312345678901');
    expect(extracted?.carrier).toBe('Amazon Logistics');
    expect(extracted?.shipmentStatus).toBe('in_transit');
    expect(extracted?.trackingUrl).toMatch(/amazon\.com.*track/i);
    expect(extracted?.shippedAt).toMatch(/^2026-01-16/);
  });

  it('extracts delivery details from the Amazon fixture', () => {
    const { subject, text } = loadFixture('amazon-delivered.txt');
    const extracted = extractLifecycleFromEmail({
      classification: 'delivery',
      subject,
      text,
      receivedAt: new Date('2026-01-18T18:00:00Z'),
    });
    expect(extracted).not.toBeNull();
    expect(extracted?.externalOrderNumber).toBe('123-4567890-1234567');
    expect(extracted?.shipmentStatus).toBe('delivered');
    expect(extracted?.deliveredAt).toMatch(/^2026-01-18/);
  });

  it('extracts refund details from the Amazon fixture', () => {
    const { subject, text } = loadFixture('amazon-refund.txt');
    const extracted = extractLifecycleFromEmail({
      classification: 'return',
      subject,
      text,
      receivedAt: new Date('2026-01-25T12:00:00Z'),
    });
    expect(extracted).not.toBeNull();
    expect(extracted?.externalOrderNumber).toBe('123-4567890-1234567');
    expect(extracted?.refundAmountCents).toBe(37584);
    expect(extracted?.itemNameHints.some((h) => /Sony/i.test(h))).toBe(true);
  });
});

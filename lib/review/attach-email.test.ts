import { describe, expect, it } from 'vitest';
import {
  attachedMessage,
  extractionForAttach,
  isAttachableClassification,
  matchOrders,
  type SearchableOrder,
} from '@/lib/review/attach-email';

describe('isAttachableClassification', () => {
  it('takes shipping, delivery and return emails', () => {
    expect(isAttachableClassification('shipping')).toBe(true);
    expect(isAttachableClassification('delivery')).toBe(true);
    expect(isAttachableClassification('return')).toBe(true);
  });

  it('refuses confirmations and anything else', () => {
    expect(isAttachableClassification('order_confirmation')).toBe(false);
    expect(isAttachableClassification('cancellation')).toBe(false);
    expect(isAttachableClassification(null)).toBe(false);
  });
});

describe('extractionForAttach', () => {
  const receivedAt = new Date('2026-08-10T12:00:00Z');

  it('reads the tracking number from the body when there is one', () => {
    const extraction = extractionForAttach({
      classification: 'shipping',
      subject: 'Your order has shipped',
      body: { text: 'UPS tracking number: 1Z999AA10123456784', html: null },
      receivedAt,
    });
    expect(extraction.trackingNumber).toBe('1Z999AA10123456784');
    expect(extraction.carrier).toBe('UPS');
    expect(extraction.shipmentStatus).toBe('in_transit');
  });

  it('still says delivered from the subject when the body could not be fetched', () => {
    const extraction = extractionForAttach({
      classification: 'delivery',
      subject: 'Your package was delivered',
      body: null,
      receivedAt,
    });
    expect(extraction.shipmentStatus).toBe('delivered');
    expect(extraction.trackingNumber).toBeNull();
  });

  it('reads a refund amount for a return', () => {
    const extraction = extractionForAttach({
      classification: 'return',
      subject: 'Refund issued',
      body: { text: 'Your refund of $24.99 has been processed.', html: null },
      receivedAt,
    });
    expect(extraction.refundAmountCents).toBe(2499);
  });
});

describe('attachedMessage', () => {
  it('names the kind of email and the order', () => {
    expect(
      attachedMessage('delivery', { merchantName: 'Acme', orderDate: '2026-08-01' }),
    ).toBe('Delivery email attached to the Acme order of 2026-08-01.');
  });
});

describe('matchOrders', () => {
  const orders: SearchableOrder[] = [
    {
      orderId: 'a',
      merchantName: 'Columbia Sportswear',
      orderDate: '2026-09-01',
      externalOrderNumber: null,
      totalCents: 100,
      currency: 'USD',
    },
    {
      orderId: 'b',
      merchantName: 'Amazon',
      orderDate: '2026-08-20',
      externalOrderNumber: '112-1234567-7654321',
      totalCents: 200,
      currency: 'USD',
    },
    {
      orderId: 'c',
      merchantName: 'Amazon',
      orderDate: '2026-07-02',
      externalOrderNumber: '113-0000000-0000000',
      totalCents: 300,
      currency: 'USD',
    },
  ];

  it('lists the newest orders when nothing is typed', () => {
    expect(matchOrders(orders, '  ', 2).map((order) => order.orderId)).toEqual(['a', 'b']);
  });

  it('needs every term to appear', () => {
    expect(matchOrders(orders, 'amazon 2026-07').map((order) => order.orderId)).toEqual(['c']);
  });

  it('finds an order by its number', () => {
    expect(matchOrders(orders, '112-12').map((order) => order.orderId)).toEqual(['b']);
  });

  it('puts a merchant the term starts with above one that only contains it', () => {
    expect(matchOrders(orders, 'um').map((order) => order.orderId)).toEqual(['a']);
    const withPrefix = [
      { ...orders[0]!, orderId: 'x', merchantName: 'Drumline' },
      { ...orders[0]!, orderId: 'y', merchantName: 'Drum Shop' },
    ];
    expect(matchOrders(withPrefix, 'drum').map((order) => order.orderId)).toEqual(['x', 'y']);
    const mixed = [
      { ...orders[0]!, orderId: 'x', merchantName: 'Lumber Co' },
      { ...orders[0]!, orderId: 'y', merchantName: 'Umbra' },
    ];
    expect(matchOrders(mixed, 'um').map((order) => order.orderId)).toEqual(['y', 'x']);
  });
});

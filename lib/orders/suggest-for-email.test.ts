import { describe, expect, it } from 'vitest';
import {
  buildOrderEvidence,
  scoreOrderCandidate,
  subjectHasOrderNumber,
  suggestOrdersForEmail,
  type LinkedMessage,
  type SuggestEmail,
  type SuggestOrder,
} from '@/lib/orders/suggest-for-email';

function order(overrides: Partial<SuggestOrder> & { id: string }): SuggestOrder {
  return {
    merchantName: 'Shop',
    merchantDomains: [],
    orderDate: '2026-08-10',
    externalOrderNumber: null,
    totalCents: 1000,
    currency: 'USD',
    ...overrides,
  };
}

const email: SuggestEmail = {
  messageId: 'msg-review',
  threadId: 'thread-1',
  subject: 'Your Costco.com order 1305271079 was delivered!',
  fromAddress: 'Costco <orders@email.costco.com>',
  replyToAddress: null,
  receivedAt: '2026-08-19T15:00:00Z',
};

const threadOrder = order({ id: 'by-thread', orderDate: '2026-01-01' });
const numberOrder = order({ id: 'by-number', externalOrderNumber: '1305271079', orderDate: '2026-02-01' });
const merchantOrder = order({ id: 'by-merchant', merchantDomains: ['costco.com'], orderDate: '2026-08-16' });

const linked: LinkedMessage[] = [
  {
    messageId: 'msg-confirmation',
    orderId: 'by-thread',
    threadId: 'thread-1',
    fromAddress: 'orders@elsewhere.com',
    replyToAddress: null,
  },
];

describe('scoreOrderCandidate', () => {
  it('matches the same thread', () => {
    const hit = scoreOrderCandidate(email, threadOrder, buildOrderEvidence(linked).get('by-thread'));
    expect(hit).toMatchObject({ signal: 'thread', reason: 'same thread' });
  });

  it('does not count the email itself as thread evidence', () => {
    const own = buildOrderEvidence([{ ...linked[0], messageId: 'msg-review' }]);
    expect(scoreOrderCandidate(email, threadOrder, own.get('by-thread'))).toBeNull();
  });

  it('matches an order number in the subject', () => {
    const hit = scoreOrderCandidate(email, numberOrder, undefined);
    expect(hit).toMatchObject({ signal: 'order_number', reason: 'order number 1305271079' });
  });

  it('matches the merchant domain when the order came shortly before', () => {
    const hit = scoreOrderCandidate(email, merchantOrder, undefined);
    expect(hit).toMatchObject({ signal: 'merchant', reason: 'same merchant, ordered 3 days before' });
  });

  it('matches the sender domain of the order own emails', () => {
    const evidence = buildOrderEvidence([
      {
        messageId: 'm2',
        orderId: 'o',
        threadId: 'other-thread',
        fromAddress: 'no-reply@costco.com',
        replyToAddress: null,
      },
    ]);
    const hit = scoreOrderCandidate(email, order({ id: 'o', orderDate: '2026-08-19' }), evidence.get('o'));
    expect(hit).toMatchObject({ signal: 'merchant', reason: 'same sender, ordered the same day' });
  });

  it('ignores a merchant order placed long before or after the email', () => {
    expect(scoreOrderCandidate(email, { ...merchantOrder, orderDate: '2026-05-01' }, undefined)).toBeNull();
    expect(scoreOrderCandidate(email, { ...merchantOrder, orderDate: '2026-08-25' }, undefined)).toBeNull();
  });

  it('never matches on a domain many shops share', () => {
    const forwarded = { ...email, subject: 'Fwd: delivered', fromAddress: 'me@gmail.com' };
    const gmailOrder = order({ id: 'g', merchantDomains: ['gmail.com'], orderDate: '2026-08-18' });
    expect(scoreOrderCandidate(forwarded, gmailOrder, undefined)).toBeNull();
  });
});

describe('suggestOrdersForEmail', () => {
  it('puts thread before order number before merchant', () => {
    const result = suggestOrdersForEmail(
      email,
      [merchantOrder, numberOrder, threadOrder],
      buildOrderEvidence(linked),
    );
    expect(result.map((c) => c.signal)).toEqual(['thread', 'order_number', 'merchant']);
  });

  it('keeps the strongest signal for an order that has several', () => {
    const both = order({ id: 'by-thread', externalOrderNumber: '1305271079', merchantDomains: ['costco.com'] });
    const [hit] = suggestOrdersForEmail(email, [both], buildOrderEvidence(linked));
    expect(hit.signal).toBe('thread');
  });

  it('ranks the nearer of two merchant orders first and stops at three', () => {
    const orders = ['2026-08-01', '2026-08-18', '2026-07-01', '2026-08-10'].map((orderDate, i) =>
      order({ id: `m${i}`, merchantDomains: ['costco.com'], orderDate }),
    );
    const result = suggestOrdersForEmail(email, orders, new Map());
    expect(result.map((c) => c.orderDate)).toEqual(['2026-08-18', '2026-08-10', '2026-08-01']);
  });

  it('returns nothing when no signal matches', () => {
    const stranger = { ...email, threadId: null, subject: 'Shipped', fromAddress: 'x@unknown.example' };
    expect(suggestOrdersForEmail(stranger, [numberOrder, merchantOrder], new Map())).toEqual([]);
  });
});

describe('subjectHasOrderNumber', () => {
  it('needs the number as a whole token', () => {
    expect(subjectHasOrderNumber('Order #112-1234567-7654321 shipped', '112-1234567-7654321')).toBe(true);
    expect(subjectHasOrderNumber('Order 9112345 shipped', '12345')).toBe(false);
  });

  it('refuses numbers too short to trust', () => {
    expect(subjectHasOrderNumber('Order 1234 shipped', '1234')).toBe(false);
  });
});

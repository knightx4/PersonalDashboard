import { describe, expect, it } from 'vitest';
import {
  filterReviewRows,
  parseReviewView,
  type ReviewRow,
} from '@/lib/review/load';

describe('parseReviewView', () => {
  it('defaults to all', () => {
    expect(parseReviewView(undefined)).toBe('all');
    expect(parseReviewView('nope')).toBe('all');
  });

  it('accepts known views', () => {
    expect(parseReviewView('orders')).toBe('orders');
    expect(parseReviewView('emails')).toBe('emails');
    expect(parseReviewView('all')).toBe('all');
  });
});

describe('filterReviewRows', () => {
  const rows: ReviewRow[] = [
    {
      kind: 'order',
      id: 'order:1',
      orderId: '1',
      orderDate: '2026-01-01',
      merchantName: 'Acme',
      externalOrderNumber: null,
      totalCents: 100,
      currency: 'USD',
      itemSummary: '1 item',
      reason: 'heuristic',
      gmailHref: null,
      sortAt: '2026-01-01',
    },
    {
      kind: 'email',
      id: 'email:2',
      messageId: '2',
      subject: 'Hi',
      fromAddress: null,
      replyToAddress: null,
      receivedAt: null,
      classification: 'order_confirmation',
      error: 'bad math',
      reason: 'bad math',
      gmailHref: null,
      inboxEmail: null,
      linkedOrderId: null,
      sortAt: '2026-01-02',
    },
  ];

  it('filters by kind', () => {
    expect(filterReviewRows(rows, 'orders')).toHaveLength(1);
    expect(filterReviewRows(rows, 'emails')).toHaveLength(1);
    expect(filterReviewRows(rows, 'all')).toHaveLength(2);
  });
});

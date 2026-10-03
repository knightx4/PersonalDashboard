import { describe, expect, it } from 'vitest';
import { onTimeSavings, type SavingsRefund } from './savings';

const refund = (over: Partial<SavingsRefund>): SavingsRefund => ({
  id: 'r1',
  refundedAt: '2026-09-30',
  amountCents: 1999,
  returnDeadline: '2026-10-05',
  currency: 'USD',
  ...over,
});

describe('onTimeSavings', () => {
  const today = '2026-10-03';

  it('sums refunds that beat their deadline this year, to the cent', () => {
    const result = onTimeSavings(
      [
        refund({ id: 'a', amountCents: 1001 }),
        refund({ id: 'b', amountCents: 2, refundedAt: '2026-02-01', returnDeadline: '2026-02-01' }),
        refund({ id: 'c', amountCents: 10, refundedAt: '2026-01-01', returnDeadline: '2026-01-15' }),
      ],
      today,
    );
    expect(result).toEqual([{ currency: 'USD', totalCents: 1013, recent: [{ id: 'a', cents: 1001 }] }]);
  });

  it('leaves out late refunds, refunds with no window and last year', () => {
    const result = onTimeSavings(
      [
        refund({ id: 'late', refundedAt: '2026-10-02', returnDeadline: '2026-10-01' }),
        refund({ id: 'none', returnDeadline: null }),
        refund({ id: 'old', refundedAt: '2025-12-30', returnDeadline: '2026-01-05' }),
        refund({ id: 'zero', amountCents: 0 }),
      ],
      today,
    );
    expect(result).toEqual([]);
  });

  it('keeps each currency apart', () => {
    const result = onTimeSavings(
      [refund({ id: 'u', amountCents: 500 }), refund({ id: 'e', amountCents: 700, currency: 'EUR' })],
      today,
    );
    expect(result.map((r) => [r.currency, r.totalCents])).toEqual([
      ['EUR', 700],
      ['USD', 500],
    ]);
  });

  it('counts only the last two weeks as recent', () => {
    const [usd] = onTimeSavings(
      [refund({ id: 'new', refundedAt: '2026-09-19' }), refund({ id: 'older', refundedAt: '2026-09-18' })],
      today,
    );
    expect(usd!.recent.map((r) => r.id)).toEqual(['new']);
  });
});

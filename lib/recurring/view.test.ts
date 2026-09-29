import { describe, expect, it } from 'vitest';
import type { RecurringCharge, RecurringPayment } from './load';
import { buildRecurringView, mayHaveLapsed, monthlyCents, priceRise } from './view';

/** The Recurring page's rules (plan #1126), against payments written by hand. */

const TODAY = '2026-09-27';

function charge(
  over: Partial<RecurringCharge> & Pick<RecurringCharge, 'occurredOn'>,
): RecurringCharge {
  return {
    id: `c-${over.occurredOn}`,
    messageId: null,
    event: 'charge',
    amountCents: 1000,
    previousAmountCents: null,
    currency: 'USD',
    period: 'month',
    dueOn: null,
    ...over,
  };
}

function payment(
  over: Partial<RecurringPayment> & Pick<RecurringPayment, 'payee'>,
): RecurringPayment {
  return {
    id: over.payee,
    kind: 'subscription',
    senderDomain: null,
    amountCents: 1000,
    currency: 'USD',
    period: 'month',
    nextDate: '2026-10-10',
    status: 'active',
    lastChargedOn: '2026-09-10',
    charges: [],
    ...over,
  };
}

describe('monthlyCents', () => {
  it('spreads weekly, quarterly and yearly amounts over a month', () => {
    expect(monthlyCents(1000, 'month')).toBe(1000);
    expect(monthlyCents(1200, 'year')).toBe(100);
    expect(monthlyCents(3000, 'quarter')).toBe(1000);
    expect(monthlyCents(1200, 'week')).toBe(5200);
  });
});

describe('priceRise', () => {
  it('finds the latest rise, from what the charge recorded it was before', () => {
    const p = payment({
      payee: 'Video',
      charges: [
        charge({ occurredOn: '2026-09-21', amountCents: 2272 }),
        charge({ occurredOn: '2026-08-21', amountCents: 2272, previousAmountCents: 2099 }),
        charge({ occurredOn: '2026-07-20', amountCents: 2099 }),
      ],
    });
    expect(priceRise(p, TODAY)).toEqual({ fromCents: 2099, toCents: 2272, on: '2026-08-21' });
  });

  it('counts a price notice before any charge at the new price', () => {
    const p = payment({
      payee: 'Tool',
      charges: [
        charge({
          occurredOn: '2026-08-22',
          event: 'price_change',
          amountCents: 4828,
          previousAmountCents: 4409,
        }),
      ],
    });
    expect(priceRise(p, TODAY)?.toCents).toBe(4828);
  });

  it('shows no rise when the latest change was a drop', () => {
    const p = payment({
      payee: 'Store',
      charges: [
        charge({ occurredOn: '2026-05-12', amountCents: 399, previousAmountCents: 856 }),
        charge({ occurredOn: '2026-04-12', amountCents: 856, previousAmountCents: 399 }),
      ],
    });
    expect(priceRise(p, TODAY)).toBeNull();
  });

  it('does not read moving from monthly to yearly as a rise', () => {
    const p = payment({
      payee: 'Cover',
      period: 'year',
      charges: [
        charge({
          occurredOn: '2026-04-03',
          amountCents: 7124,
          previousAmountCents: 1081,
          period: 'year',
        }),
        charge({ occurredOn: '2026-02-27', amountCents: 1081, period: 'month' }),
      ],
    });
    expect(priceRise(p, TODAY)).toBeNull();
  });

  it('stops showing a rise a year after it happened', () => {
    const p = payment({
      payee: 'Old',
      charges: [charge({ occurredOn: '2025-08-01', amountCents: 1200, previousAmountCents: 1000 })],
    });
    expect(priceRise(p, TODAY)).toBeNull();
  });
});

describe('mayHaveLapsed', () => {
  it('allows a monthly charge a week past its date', () => {
    expect(mayHaveLapsed(payment({ payee: 'a', nextDate: '2026-09-21' }), TODAY)).toBe(false);
    expect(mayHaveLapsed(payment({ payee: 'b', nextDate: '2026-09-19' }), TODAY)).toBe(true);
  });

  it('never flags a payment with no next date, or one cancelled', () => {
    expect(mayHaveLapsed(payment({ payee: 'a', nextDate: null }), TODAY)).toBe(false);
    expect(
      mayHaveLapsed(payment({ payee: 'b', nextDate: '2026-01-01', status: 'cancelled' }), TODAY),
    ).toBe(false);
  });
});

describe('buildRecurringView', () => {
  const view = buildRecurringView(
    [
      payment({ payee: 'Cloud', amountCents: 999, nextDate: '2026-10-25' }),
      payment({ payee: 'Photos', amountCents: 10824, period: 'year', nextDate: '2027-01-15' }),
      payment({ payee: 'Tool', amountCents: 4828, nextDate: null }),
      payment({ payee: 'Unknown', amountCents: null, nextDate: '2026-10-01' }),
      payment({ payee: 'Cable', kind: 'bill', amountCents: 9595, nextDate: '2026-07-21' }),
      payment({ payee: 'Gone', status: 'cancelled', nextDate: null }),
      payment({ payee: 'Chase', kind: 'bill', status: 'ignored', amountCents: 2423300 }),
    ],
    TODAY,
  );

  it('lists what is still charging soonest first, with no date last', () => {
    expect(view.active.map((r) => r.payee)).toEqual(['Unknown', 'Cloud', 'Photos', 'Tool']);
  });

  it('adds the active payments up a month at a time, and says what it could not count', () => {
    expect(view.total).toEqual([{ currency: 'USD', cents: 999 + 902 + 4828, uncounted: 1 }]);
  });

  it('keeps lapsed payments out of the total and totals them apart', () => {
    expect(view.lapsed.map((r) => r.payee)).toEqual(['Cable']);
    expect(view.lapsedTotal).toEqual([{ currency: 'USD', cents: 9595, uncounted: 0 }]);
    expect(view.cancelled.map((r) => r.payee)).toEqual(['Gone']);
  });

  it('keeps a payment left out of the total in its own list, out of every total', () => {
    expect(view.ignored.map((r) => r.payee)).toEqual(['Chase']);
    expect(view.active.map((r) => r.payee)).not.toContain('Chase');
    expect(view.lapsedTotal[0]!.cents).toBe(9595);
  });
});

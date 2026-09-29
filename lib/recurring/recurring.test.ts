import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyMessage } from '@/lib/email/extract/classify';
import { classifyRecurring, recurringCatchUpQuery } from './rules';
import {
  heuristicRecurring,
  parseRecurringExtraction,
  payeeKey,
  type RecurringExtraction,
} from './extraction';
import { addPeriod, periodFromGaps, summariseCharges, type ChargeRow } from './summarise';

/**
 * The recurring-payments linker against saved messages (plan #1125).
 *
 * fixtures/emails/recurring holds one email per kind the linker files: a
 * subscription charge, a store receipt for a subscription, a processor
 * receipt, a price change, a renewal notice, a utility bill, and a newsletter
 * opt-in it must leave alone. They are written to each sender's usual layout,
 * not saved from the inbox: none of this mail had been read into it when they
 * were written. Swap each for a saved message with the details removed once
 * the catch-up has read the real ones. The order fixtures beside them are
 * saved order mail; the linker must not claim any of them, and the commerce
 * classifier must still file them as orders.
 */

type Fixture = { subject: string; fromAddress: string | null; text: string };

function load(name: string, fromAddress: string | null = null): Fixture {
  const raw = readFileSync(resolve(__dirname, '../../fixtures/emails', name), 'utf8');
  const subject = raw.match(/^Subject: (.*)$/m)?.[1] ?? '';
  const from = raw.match(/^From: (.*)$/m)?.[1] ?? fromAddress;
  const body = raw.replace(/^(?:Subject|From): .*\n/gm, '').trim();
  return { subject, fromAddress: from, text: body };
}

function read(name: string, receivedOn: string): RecurringExtraction | null {
  const email = load(`recurring/${name}`);
  const verdict = classifyRecurring(email);
  if (!verdict.claim) throw new Error(`${name} was not claimed`);
  return heuristicRecurring({ ...email, receivedOn, hint: verdict.hint });
}

describe('classifyRecurring on saved mail', () => {
  it.each([
    ['netflix-charge.txt', 'subscription'],
    ['apple-icloud-receipt.txt', 'subscription'],
    ['notion-stripe-receipt.txt', 'subscription'],
    ['nytimes-renewal.txt', 'subscription'],
    ['spotify-price-change.txt', 'price_change'],
    ['coned-bill.txt', 'bill'],
  ])('claims %s as %s', (name, hint) => {
    const verdict = classifyRecurring(load(`recurring/${name}`));
    expect(verdict).toMatchObject({ claim: true, hint });
  });

  it('leaves a newsletter opt-in alone', () => {
    expect(classifyRecurring(load('recurring/newsletter-confirm.txt')).claim).toBe(false);
  });

  it.each([
    ['amazon-order-confirmation.txt'],
    ['amazon-multi-item-ordered.txt'],
    ['amazon-shipped.txt'],
    ['amazon-delivered.txt'],
    ['amazon-refund.txt'],
    ['shopify-allplay-order.txt'],
    ['shopify-goods-of-desire-order.txt'],
    ['shopify-ms-betters-order.txt'],
  ])('does not claim the order email %s, which commerce still files', (name) => {
    const email = load(name, 'auto-confirm@amazon.com');
    expect(classifyRecurring(email).claim).toBe(false);
    expect(classifyMessage({ ...email, merchants: [] }).classification).not.toBe('not_relevant');
  });

  it('files order confirmations as orders exactly as before', () => {
    for (const name of [
      'amazon-order-confirmation.txt',
      'shopify-allplay-order.txt',
      'shopify-ms-betters-order.txt',
    ]) {
      const email = load(name, 'auto-confirm@amazon.com');
      expect(classifyMessage({ ...email, merchants: [] }).classification).toBe('order_confirmation');
    }
  });

  // Subjects from the live inbox's envelopes. Order and job mail that uses
  // money words must stay unclaimed.
  it.each([
    ['Receipt for Order #VW2274770', 'Airmail <receipts@airmail.net>'],
    ['Online Order Receipt for $32.20 at Atticus Market - 771 Orange St', 'Toast <noreply@toasttab.com>'],
    ["We're sending you a refund for your PayPal Pay in 4 plan", '"PayPal" <service@paypal.com>'],
    ['You have a refund from Paddle.net', '"PayPal" <service@paypal.com>'],
    ['Thank you for your application | Alternative Payments', 'no-reply@ashbyhq.com'],
    ['Your Order Confirmation', 'TurboTax <turbotax@intuit.com>'],
    ['TurboTax Update: Federal Return Accepted', 'TurboTax <do_not_reply@intuit.com>'],
  ])('does not claim "%s"', (subject, fromAddress) => {
    expect(classifyRecurring({ subject, fromAddress }).claim).toBe(false);
  });

  it('ignores marketing from a known biller', () => {
    expect(
      classifyRecurring({ subject: 'New on Netflix this week', fromAddress: 'info@netflix.com' }).claim,
    ).toBe(false);
  });

  it('asks Gmail by subject only, back far enough for an annual renewal', () => {
    const query = recurringCatchUpQuery();
    expect(query).toMatch(/^newer_than:400d \(/);
    expect(query).not.toMatch(/from:/);
  });
});

describe('heuristicRecurring on saved mail', () => {
  it('reads a subscription charge and its next billing date', () => {
    expect(read('netflix-charge.txt', '2026-09-03')).toEqual({
      payee: 'Netflix',
      kind: 'subscription',
      event: 'charge',
      amountCents: 1799,
      previousAmountCents: null,
      currency: 'USD',
      period: 'month',
      occurredOn: '2026-09-03',
      dueOn: '2026-10-03',
    });
  });

  it('reads a price change as the new price with the old one kept', () => {
    expect(read('spotify-price-change.txt', '2026-09-10')).toMatchObject({
      payee: 'Spotify',
      event: 'price_change',
      amountCents: 1299,
      previousAmountCents: 1199,
      period: 'month',
      dueOn: '2026-10-14',
    });
  });

  it('reads a utility bill with its amount due and due date', () => {
    expect(read('coned-bill.txt', '2026-09-18')).toMatchObject({
      payee: 'Con Edison',
      kind: 'bill',
      event: 'bill',
      amountCents: 8412,
      occurredOn: '2026-09-18',
      dueOn: '2026-10-15',
    });
  });

  it('names a processor receipt after the company, not the processor', () => {
    expect(read('notion-stripe-receipt.txt', '2026-09-12')).toMatchObject({
      payee: 'Notion Labs, Inc',
      event: 'charge',
      amountCents: 1000,
      occurredOn: '2026-09-12',
      period: 'month',
    });
  });

  it('reads an annual renewal notice with its price and date', () => {
    expect(read('nytimes-renewal.txt', '2026-10-20')).toMatchObject({
      event: 'renewal_notice',
      amountCents: 19500,
      period: 'year',
      dueOn: '2026-11-02',
    });
  });

  it('gives up on an Apple receipt rather than filing it under "Apple"', () => {
    // The service is named only in the body, so the heuristic has nothing but
    // the store's name; the reading fails and the linker tries again (plan #1212).
    expect(read('apple-icloud-receipt.txt', '2026-09-20')).toBeNull();
  });
});

describe('parseRecurringExtraction', () => {
  it('accepts a complete answer and defaults the date and currency', () => {
    const parsed = parseRecurringExtraction(
      { payee: 'Netflix', kind: 'subscription', event: 'charge', amountCents: 1799, period: 'month' },
      '2026-09-03',
    );
    expect(parsed).toEqual({
      ok: true,
      value: expect.objectContaining({ currency: 'USD', occurredOn: '2026-09-03', dueOn: null }),
    });
  });

  it('tells "not recurring" apart from an answer that does not hold', () => {
    expect(parseRecurringExtraction({ error: 'not_recurring' }, '2026-09-03')).toEqual({
      ok: false,
      notRecurring: true,
    });
    expect(
      parseRecurringExtraction(
        { payee: 'Netflix', kind: 'subscription', event: 'charge', amountCents: null },
        '2026-09-03',
      ),
    ).toEqual({ ok: false, notRecurring: false });
    expect(
      parseRecurringExtraction({ payee: 'X', kind: 'rent', event: 'charge' }, '2026-09-03'),
    ).toEqual({ ok: false, notRecurring: false });
  });
});

describe('payeeKey', () => {
  it('files spellings of one payee together', () => {
    expect(payeeKey('Netflix, Inc.')).toBe(payeeKey('NETFLIX'));
    expect(payeeKey('Notion Labs, Inc')).toBe('notionlabs');
    expect(payeeKey('iCloud+')).toBe('icloud');
  });
});

describe('summariseCharges', () => {
  function charge(partial: Partial<ChargeRow> & Pick<ChargeRow, 'id' | 'occurredOn'>): ChargeRow {
    return {
      event: 'charge',
      amountCents: 1199,
      previousAmountCents: null,
      currency: 'USD',
      period: null,
      dueOn: null,
      ...partial,
    };
  }

  it('records a rise on the first charge at the new price, whatever order the mail was read in', () => {
    // Newest first, as the catch-up reads the mailbox.
    const summary = summariseCharges('subscription', [
      charge({ id: 'c3', occurredOn: '2026-09-14', amountCents: 1299 }),
      charge({ id: 'c2', occurredOn: '2026-08-14' }),
      charge({ id: 'c1', occurredOn: '2026-07-14' }),
    ]);
    expect(summary.amountCents).toBe(1299);
    expect(summary.period).toBe('month');
    expect(summary.lastChargedOn).toBe('2026-09-14');
    expect(summary.nextDate).toBe('2026-10-14');
    expect(summary.previousAmounts).toEqual(new Map([['c3', 1199]]));
  });

  it('shows an announced price before it is charged, and keeps the notice as the change', () => {
    const summary = summariseCharges('subscription', [
      charge({ id: 'c1', occurredOn: '2026-09-14' }),
      charge({
        id: 'p1',
        event: 'price_change',
        occurredOn: '2026-09-20',
        amountCents: 1299,
        previousAmountCents: 1199,
        dueOn: '2026-10-14',
      }),
    ]);
    expect(summary.amountCents).toBe(1299);
    expect(summary.nextDate).toBe('2026-10-14');
    expect(summary.previousAmounts.has('p1')).toBe(false);
  });

  it('does not call a bill that varies a price change', () => {
    const summary = summariseCharges('bill', [
      charge({ id: 'b1', event: 'bill', occurredOn: '2026-08-18', amountCents: 9120, dueOn: '2026-09-15' }),
      charge({ id: 'b2', event: 'bill', occurredOn: '2026-09-18', amountCents: 8412, dueOn: '2026-10-15' }),
    ]);
    expect(summary.previousAmounts.size).toBe(0);
    expect(summary.nextDate).toBe('2026-10-15');
    expect(summary.amountCents).toBe(8412);
  });

  it('marks a cancellation, and a later charge makes it active again', () => {
    const cancelled = summariseCharges('subscription', [
      charge({ id: 'c1', occurredOn: '2026-08-01', period: 'month' }),
      charge({ id: 'x', event: 'cancelled', occurredOn: '2026-08-10', amountCents: null }),
    ]);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.nextDate).toBeNull();

    const back = summariseCharges('subscription', [
      charge({ id: 'c1', occurredOn: '2026-08-01', period: 'month' }),
      charge({ id: 'x', event: 'cancelled', occurredOn: '2026-08-10', amountCents: null }),
      charge({ id: 'c2', occurredOn: '2026-09-05' }),
    ]);
    expect(back.status).toBe('active');
    expect(back.nextDate).toBe('2026-10-05');
  });

  it('leaves a next date in the past standing, which is how a lapse shows', () => {
    const summary = summariseCharges('subscription', [
      charge({ id: 'c1', occurredOn: '2026-01-10', period: 'month' }),
    ]);
    expect(summary.nextDate).toBe('2026-02-10');
  });
});

describe('dates', () => {
  it('adds a period keeping the day of the month where it can', () => {
    expect(addPeriod('2026-01-31', 'month')).toBe('2026-02-28');
    expect(addPeriod('2026-09-14', 'year')).toBe('2027-09-14');
    expect(addPeriod('2026-09-14', 'quarter')).toBe('2026-12-14');
    expect(addPeriod('2026-09-14', 'week')).toBe('2026-09-21');
  });

  it('infers a period from the gaps between charges', () => {
    expect(periodFromGaps(['2026-06-01', '2026-07-01', '2026-08-01'])).toBe('month');
    expect(periodFromGaps(['2025-03-02', '2026-03-02'])).toBe('year');
    expect(periodFromGaps(['2026-06-01'])).toBeNull();
  });
});

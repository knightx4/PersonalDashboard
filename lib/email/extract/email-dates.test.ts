import { describe, expect, it } from 'vitest';
import {
  extractExpectedDeliveryOn,
  extractLifecycleEventAt,
  extractOrderDateYmd,
  parseLooseCalendarDate,
} from './email-dates';

describe('parseLooseCalendarDate', () => {
  it('parses month-name dates', () => {
    expect(parseLooseCalendarDate('January 15, 2026', 2026)).toBe('2026-01-15');
    expect(parseLooseCalendarDate('Jan 16', 2026)).toBe('2026-01-16');
  });

  it('parses US slash dates', () => {
    expect(parseLooseCalendarDate('05/22/2026', 2026)).toBe('2026-05-22');
    expect(parseLooseCalendarDate('1/5/26', 2026)).toBe('2026-01-05');
  });

  it('treats day-first when month would be invalid', () => {
    expect(parseLooseCalendarDate('22/05/2026', 2026)).toBe('2026-05-22');
  });
});

describe('extractOrderDateYmd', () => {
  it('prefers Order Date in the body over a later Gmail receivedAt', () => {
    const blob = [
      'Subject: Your Amazon.com order',
      'Order #123-4567890-1234567',
      'Order Date: January 15, 2026',
      'Order Total: $10.00',
    ].join('\n');
    expect(extractOrderDateYmd(blob, new Date('2026-08-20T18:00:00Z'))).toBe(
      '2026-01-15',
    );
  });

  it('parses Shopify Date MM/DD/YYYY lines', () => {
    const blob = 'Thank you for placing your order.\n\nDate 05/22/2026\n\nTotal $10.00';
    expect(extractOrderDateYmd(blob, new Date('2026-08-20T12:00:00Z'))).toBe(
      '2026-05-22',
    );
  });

  it('falls back to receivedAt when no body date exists', () => {
    const blob = 'Thanks for your order!\nOrder Total: $10.00';
    expect(extractOrderDateYmd(blob, new Date('2026-03-30T04:37:57Z'))).toBe(
      '2026-03-30',
    );
  });
});

describe('extractLifecycleEventAt', () => {
  it('prefers Shipped on body text over receivedAt', () => {
    const blob = 'Your package was shipped.\nShipped on January 16, 2026\n';
    expect(
      extractLifecycleEventAt(blob, 'shipped', new Date('2026-08-20T18:00:00Z')),
    ).toBe('2026-01-16T12:00:00.000Z');
  });

  it('falls back to receivedAt when no ship date label exists', () => {
    const received = new Date('2026-08-20T18:00:00Z');
    expect(extractLifecycleEventAt('Your package has shipped.', 'shipped', received)).toBe(
      received.toISOString(),
    );
  });
});

describe('extractExpectedDeliveryOn (plan #1127)', () => {
  // A Sunday.
  const received = new Date('2026-09-27T14:00:00Z');

  it('reads a weekday and a month-day', () => {
    expect(extractExpectedDeliveryOn('Arriving Wednesday, October 1', received)).toBe('2026-10-01');
    expect(extractExpectedDeliveryOn('Estimated delivery: Oct 3 - Oct 5', received)).toBe('2026-10-03');
    expect(extractExpectedDeliveryOn('Expected delivery date: 10/02/2026', received)).toBe('2026-10-02');
  });

  it('counts a bare weekday, today and tomorrow from the day the email came', () => {
    expect(extractExpectedDeliveryOn('Arriving Wednesday', received)).toBe('2026-09-30');
    expect(extractExpectedDeliveryOn('Get it by Friday', received)).toBe('2026-10-02');
    expect(extractExpectedDeliveryOn('Arriving today by 10pm', received)).toBe('2026-09-27');
    expect(extractExpectedDeliveryOn('Your package arrives tomorrow', received)).toBe('2026-09-28');
  });

  it('puts a January day read in December in the next year', () => {
    expect(extractExpectedDeliveryOn('Arriving Jan 3', new Date('2026-12-28T12:00:00Z'))).toBe('2027-01-03');
  });

  it('reads through markup and gives null when no day is named', () => {
    expect(extractExpectedDeliveryOn('<b>Arriving:</b> <span>Thu, Oct 1</span>', received)).toBe('2026-10-01');
    expect(extractExpectedDeliveryOn('Free delivery by Amazon. Your package has shipped.', received)).toBeNull();
  });
});

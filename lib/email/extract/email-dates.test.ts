import { describe, expect, it } from 'vitest';
import {
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

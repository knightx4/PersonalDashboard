import { describe, expect, it } from 'vitest';
import { quoteIsCurrent, quoteTtlMs } from '@/lib/sell/quote-cache';

const NOW = Date.parse('2026-08-28T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW - n * 3600_000).toISOString();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('quoteTtlMs', () => {
  it('caches a billed web estimate far longer than a cheap lookup', () => {
    expect(quoteTtlMs('web_estimate')).toBeGreaterThan(quoteTtlMs('ebay_browse'));
    expect(quoteTtlMs('ebay_browse')).toBe(quoteTtlMs('buyback'));
  });
});

describe('quoteIsCurrent', () => {
  it('accepts a fresh quote that carries a price', () => {
    expect(
      quoteIsCurrent({ quoted_cents: 1250, fetched_at: hoursAgo(1) }, 'ebay_browse', NOW),
    ).toBe(true);
  });

  it('rejects a quote past its source ttl', () => {
    expect(
      quoteIsCurrent({ quoted_cents: 1250, fetched_at: hoursAgo(13) }, 'ebay_browse', NOW),
    ).toBe(false);
    // The same age is still current for a web estimate, which caches for a month.
    expect(
      quoteIsCurrent({ quoted_cents: 1250, fetched_at: hoursAgo(13) }, 'web_estimate', NOW),
    ).toBe(true);
    expect(
      quoteIsCurrent({ quoted_cents: 1250, fetched_at: daysAgo(31) }, 'web_estimate', NOW),
    ).toBe(false);
  });

  it('rejects a row that holds no price, however fresh', () => {
    // The regression this module exists for: a failed lookup writes a row with
    // a null price. Counting that as an answer wedged the estimate button --
    // the page called the book unpriced, the action called it priced.
    expect(
      quoteIsCurrent({ quoted_cents: null, fetched_at: hoursAgo(0) }, 'web_estimate', NOW),
    ).toBe(false);
  });

  it('rejects rows with no timestamp, and missing rows', () => {
    expect(quoteIsCurrent({ quoted_cents: 900, fetched_at: null }, 'buyback', NOW)).toBe(false);
    expect(quoteIsCurrent(null, 'buyback', NOW)).toBe(false);
    expect(quoteIsCurrent(undefined, 'buyback', NOW)).toBe(false);
  });

  it('rejects an unparseable timestamp rather than treating it as epoch', () => {
    expect(
      quoteIsCurrent({ quoted_cents: 900, fetched_at: 'not a date' }, 'buyback', NOW),
    ).toBe(false);
  });
});

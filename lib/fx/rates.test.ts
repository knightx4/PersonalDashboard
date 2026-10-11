import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractCurrencyCode } from '@/lib/email/extract/currency';
import { convertCents } from '@/lib/fx/money-fx';
import { clearMemoryFxCache, convertAmounts, getFxRate, memoryFxCache } from '@/lib/fx/rates';

describe('extractCurrencyCode', () => {
  it('reads trailing ISO codes on totals', () => {
    expect(extractCurrencyCode('Total : $396.33 HKD')).toBe('HKD');
    expect(extractCurrencyCode('Subtotal : $180.00 HKD\nShipping : $216.33 HKD')).toBe(
      'HKD',
    );
  });

  it('falls back to USD absence', () => {
    expect(extractCurrencyCode('Total $12.00')).toBeNull();
  });
});

describe('convertCents', () => {
  it('rounds half up via Math.round', () => {
    expect(convertCents(39633, 0.12761)).toBe(5058);
  });
});

describe('getFxRate / convertAmounts', () => {
  // Frankfurter itself, not a stand-in, until 6 October 2026: it answered in a
  // quarter of a second or not within 25, and the gate timed out on it twice.
  // The answer here has Frankfurter's shape and a rate where HKD trades
  // against USD, so the checks below still test what the code does with one.
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls += 1;
        const to = new URL(url).searchParams.get('to') ?? 'USD';
        return new Response(
          JSON.stringify({ amount: 1, base: 'HKD', date: '2026-05-22', rates: { [to]: 0.12761 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns identity for same currency', async () => {
    const quote = await getFxRate({ from: 'USD', to: 'usd', date: '2026-05-22' });
    expect(quote.rate).toBe(1);
    expect(quote.source).toBe('identity');
  });

  it('fetches historical HKD→USD from Frankfurter and caches', async () => {
    clearMemoryFxCache();
    const cache = memoryFxCache();
    const quote = await getFxRate(
      { from: 'HKD', to: 'USD', date: '2026-05-22' },
      cache,
    );
    expect(quote.from).toBe('HKD');
    expect(quote.to).toBe('USD');
    expect(quote.rate).toBeGreaterThan(0.1);
    expect(quote.rate).toBeLessThan(0.2);
    expect(quote.rateDate).toBe('2026-05-22');
    expect(quote.source).toBe('frankfurter');

    const again = await getFxRate(
      { from: 'HKD', to: 'USD', date: '2026-05-22' },
      cache,
    );
    expect(again.rate).toBe(quote.rate);
    expect(calls).toBe(1);
  });

  it('converts a batch of mixed native amounts', async () => {
    clearMemoryFxCache();
    const [usd, hkd] = await convertAmounts(
      [
        { cents: 1000, currency: 'USD', date: '2026-05-22' },
        { cents: 39633, currency: 'HKD', date: '2026-05-22' },
      ],
      'USD',
    );
    expect(usd).toBe(1000);
    expect(hkd).toBeGreaterThan(4000);
    expect(hkd).toBeLessThan(6000);
  });
});

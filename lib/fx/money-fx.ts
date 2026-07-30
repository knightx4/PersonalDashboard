import { KNOWN_CURRENCY_CODES } from '@/lib/email/extract/currency';

/** Currencies users can pick for display (Frankfurter-supported set). */
export const DISPLAY_CURRENCIES = [...KNOWN_CURRENCY_CODES].sort();

export function normalizeCurrencyCode(raw: string | null | undefined): string {
  const code = (raw ?? 'USD').trim().toUpperCase();
  if (code.length !== 3) return 'USD';
  return code;
}

export function isSupportedDisplayCurrency(code: string): boolean {
  return KNOWN_CURRENCY_CODES.has(normalizeCurrencyCode(code));
}

/** Integer cents × rate → integer cents in the quote currency. */
export function convertCents(cents: number, rate: number): number {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`convertCents expects integer cents, got ${cents}`);
  }
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new RangeError(`convertCents expects a positive finite rate, got ${rate}`);
  }
  return Math.round(cents * rate);
}

export function fxCacheKey(rateDate: string, from: string, to: string): string {
  return `${rateDate}|${normalizeCurrencyCode(from)}|${normalizeCurrencyCode(to)}`;
}

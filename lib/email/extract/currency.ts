/** ISO codes Frankfurter (and most confirmations) actually emit. */
export const KNOWN_CURRENCY_CODES = new Set([
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
]);

/**
 * Prefer an ISO code printed next to a money amount (e.g. "$396.33 HKD").
 * Falls back to a bare code near Total/Subtotal labels.
 */
export function extractCurrencyCode(text: string): string | null {
  if (!text) return null;

  const withAmount = [
    ...text.matchAll(/\$?\s*[0-9,]+\.\d{2}\s+([A-Z]{3})\b/g),
    ...text.matchAll(/\b([A-Z]{3})\s+\$?\s*[0-9,]+\.\d{2}\b/g),
  ];
  for (let i = withAmount.length - 1; i >= 0; i--) {
    const code = withAmount[i]?.[1];
    if (code && KNOWN_CURRENCY_CODES.has(code)) return code;
  }

  const labeled = text.match(
    /\b(?:order\s*total|grand\s*total|total\s*charged|amount\s*paid|subtotal|shipping|total)\b[^A-Za-z]{0,40}\b([A-Z]{3})\b/i,
  );
  const labeledCode = labeled?.[1]?.toUpperCase();
  if (labeledCode && KNOWN_CURRENCY_CODES.has(labeledCode)) return labeledCode;

  return null;
}

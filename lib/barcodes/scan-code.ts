/**
 * Classify a scanned barcode.
 *
 * The scanner reads any EAN-13 / UPC-A. A 978/979 prefix is Bookland — that
 * is a book and belongs to the ISBN path. Everything else is a retail product
 * (board games included) and needs a UPC lookup instead.
 */
import { normalizeIsbn } from '@/lib/books/isbn';

export type ScannedCode =
  | { kind: 'isbn'; isbn13: string }
  | { kind: 'product'; ean13: string; upc12: string | null };

function digitsOnly(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

/** EAN-13 / UPC-A share one check-digit algorithm once padded to 13. */
export function isValidEan13(raw: string): boolean {
  const s = digitsOnly(raw);
  if (s.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

/** UPC-A (12 digits) is an EAN-13 with a leading zero. */
export function upcToEan13(raw: string): string | null {
  const s = digitsOnly(raw);
  if (s.length === 12) {
    const padded = `0${s}`;
    return isValidEan13(padded) ? padded : null;
  }
  if (s.length === 13) return isValidEan13(s) ? s : null;
  return null;
}

/** Drop the EAN-13 leading zero when the code is really a UPC-A. */
export function ean13ToUpc(ean13: string): string | null {
  const s = digitsOnly(ean13);
  return s.length === 13 && s.startsWith('0') ? s.slice(1) : null;
}

/**
 * What did we just scan? Null when the digits are not a valid retail barcode —
 * a misread is far more likely than an exotic symbology.
 */
export function classifyScannedCode(raw: string | null | undefined): ScannedCode | null {
  if (!raw) return null;
  const s = digitsOnly(raw);
  if (!s) return null;

  // ISBN-10 and ISBN-13 both carry their own validation.
  const isbn = normalizeIsbn(s);
  if (isbn) return { kind: 'isbn', isbn13: isbn.isbn13 };

  const ean13 = upcToEan13(s);
  if (!ean13) return null;
  return { kind: 'product', ean13, upc12: ean13ToUpc(ean13) };
}

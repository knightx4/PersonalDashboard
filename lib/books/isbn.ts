/**
 * ISBN-10 / ISBN-13 normalize, validate, and convert.
 *
 * Barcodes and pasted strings arrive with hyphens, spaces, and occasional
 * trailing X check digits. Everything downstream wants a clean digit string.
 */

const ISBN_DIGITS = /[^0-9X]/gi;

/** Strip separators; keep digits and trailing X. */
export function stripIsbn(raw: string): string {
  return raw.replace(ISBN_DIGITS, '').toUpperCase();
}

function isbn10CheckDigit(body9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (10 - i) * Number(body9[i]);
  }
  const rem = (11 - (sum % 11)) % 11;
  return rem === 10 ? 'X' : String(rem);
}

function isbn13CheckDigit(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn10(raw: string): boolean {
  const s = stripIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  return isbn10CheckDigit(s.slice(0, 9)) === s[9];
}

export function isValidIsbn13(raw: string): boolean {
  const s = stripIsbn(raw);
  if (!/^\d{13}$/.test(s)) return false;
  // Bookland EANs start with 978 or 979.
  if (!s.startsWith('978') && !s.startsWith('979')) return false;
  return isbn13CheckDigit(s.slice(0, 12)) === s[12];
}

export function isValidIsbn(raw: string): boolean {
  const s = stripIsbn(raw);
  if (s.length === 10) return isValidIsbn10(s);
  if (s.length === 13) return isValidIsbn13(s);
  return false;
}

/** Convert a valid ISBN-10 to ISBN-13 (978 prefix). */
export function isbn10To13(raw: string): string | null {
  const s = stripIsbn(raw);
  if (!isValidIsbn10(s)) return null;
  const body12 = `978${s.slice(0, 9)}`;
  return body12 + isbn13CheckDigit(body12);
}

/** Convert a 978-prefixed ISBN-13 to ISBN-10. 979 cannot convert. */
export function isbn13To10(raw: string): string | null {
  const s = stripIsbn(raw);
  if (!isValidIsbn13(s)) return null;
  if (!s.startsWith('978')) return null;
  const body9 = s.slice(3, 12);
  return body9 + isbn10CheckDigit(body9);
}

export type NormalizedIsbn = {
  isbn13: string;
  isbn10: string | null;
};

/**
 * Accept ISBN-10 or ISBN-13 (with or without hyphens). Returns both forms when
 * possible. Null when the input is not a valid ISBN.
 */
export function normalizeIsbn(raw: string | null | undefined): NormalizedIsbn | null {
  if (!raw) return null;
  const s = stripIsbn(raw);
  if (s.length === 10) {
    if (!isValidIsbn10(s)) return null;
    const isbn13 = isbn10To13(s);
    if (!isbn13) return null;
    return { isbn13, isbn10: s };
  }
  if (s.length === 13) {
    if (!isValidIsbn13(s)) return null;
    return { isbn13: s, isbn10: isbn13To10(s) };
  }
  return null;
}

/**
 * Detect whether a free-text line looks like it is primarily an ISBN
 * (barcode paste, "ISBN 978-…", etc.) rather than a title.
 */
export function extractIsbnFromText(raw: string): string | null {
  const match = raw.match(/(?:ISBN(?:-1[03])?[:\s]*)?((?:\d[\d\- ]{8,16}[\dXx]))/i);
  if (!match?.[1]) return null;
  const normalized = normalizeIsbn(match[1]);
  return normalized?.isbn13 ?? null;
}

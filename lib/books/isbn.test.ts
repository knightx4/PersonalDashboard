import { describe, expect, it } from 'vitest';
import {
  extractIsbnFromText,
  isbn10To13,
  isbn13To10,
  isValidIsbn,
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
  stripIsbn,
} from './isbn';

describe('isbn', () => {
  it('round-trips a known ISBN-10/13 pair', () => {
    const isbn10 = '0735211299';
    const isbn13 = '9780735211292';
    expect(isbn10To13(isbn10)).toBe(isbn13);
    expect(isbn13To10(isbn13)).toBe(isbn10);
    expect(isValidIsbn(isbn10)).toBe(true);
    expect(isValidIsbn(isbn13)).toBe(true);
    expect(isValidIsbn10(isbn10)).toBe(true);
    expect(isValidIsbn13(isbn13)).toBe(true);
  });

  it('rejects bad check digits', () => {
    expect(normalizeIsbn('9780735211293')).toBeNull();
    expect(stripIsbn('978-0-7352-1129-2')).toBe('9780735211292');
  });

  it('extractIsbnFromText finds embedded ISBNs', () => {
    expect(extractIsbnFromText('see ISBN 9780735211292 on the back')).toBe(
      '9780735211292',
    );
    expect(extractIsbnFromText('no numbers here')).toBeNull();
  });
});

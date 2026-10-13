import { describe, expect, it } from 'vitest';
import { cleanReadingText, MAX_READING_TEXT } from './reading-text';

describe('cleanReadingText', () => {
  it('trims and normalises line endings', () => {
    expect(cleanReadingText('  a\r\nb\rc \n')).toEqual({ ok: true, text: 'a\nb\nc' });
  });
  it('refuses nothing', () => {
    expect(cleanReadingText('  \n ').ok).toBe(false);
  });
  it('accepts exactly the cap and refuses one more', () => {
    expect(cleanReadingText('x'.repeat(MAX_READING_TEXT)).ok).toBe(true);
    expect(cleanReadingText('x'.repeat(MAX_READING_TEXT + 1)).ok).toBe(false);
  });
});

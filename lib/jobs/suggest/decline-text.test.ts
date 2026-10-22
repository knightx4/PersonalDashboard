import { describe, expect, it } from 'vitest';
import { DECLINE_TEXT_MAX, declineText } from './decline-text';

describe('declineText', () => {
  it('stores nothing for an empty or blank box', () => {
    expect(declineText('')).toBeNull();
    expect(declineText('   \n ')).toBeNull();
    expect(declineText(null)).toBeNull();
    expect(declineText(undefined)).toBeNull();
  });

  it('trims what was typed', () => {
    expect(declineText('  too senior, and a long commute \n')).toBe('too senior, and a long commute');
  });

  it('cuts it at the cap', () => {
    const long = 'a'.repeat(DECLINE_TEXT_MAX + 40);
    expect(declineText(long)).toHaveLength(DECLINE_TEXT_MAX);
  });
});

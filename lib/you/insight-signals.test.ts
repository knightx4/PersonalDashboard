import { describe, expect, it } from 'vitest';
import { ruleWords } from './insight-signals';

describe('ruleWords (plan #2413.7)', () => {
  it('gives each excluded industry its own name and the words that mean it', () => {
    const words = ruleWords(['Crypto', 'Defense']);
    expect(Object.keys(words)).toEqual(['Crypto', 'Defense']);
    expect(words.Crypto).toContain('crypto');
    expect(words.Crypto).toContain('web3');
    expect(words.Defense).toContain('defense');
  });

  it('keeps an industry with no word list as itself, and skips blanks', () => {
    expect(ruleWords(['Gambling', '  '])).toEqual({ Gambling: ['gambling'] });
  });
});

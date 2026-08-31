import { describe, expect, it } from 'vitest';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';

describe('searching the lists', () => {
  it('matches a company by part of its name', () => {
    expect(matchesSearch(['Kalshi', 'Finance Manager'], searchTerms('kal'))).toBe(true);
  });

  it('matches a role and a company together, in either order', () => {
    const fields = ['Ramp', 'Strategic Finance Analyst'];
    expect(matchesSearch(fields, searchTerms('ramp analyst'))).toBe(true);
    expect(matchesSearch(fields, searchTerms('analyst ramp'))).toBe(true);
  });

  it('requires every term to land somewhere', () => {
    expect(matchesSearch(['Ramp', 'Strategic Finance Analyst'], searchTerms('ramp designer'))).toBe(
      false,
    );
  });

  it('shows everything when nothing has been typed', () => {
    expect(matchesSearch(['Ramp'], searchTerms(''))).toBe(true);
    expect(matchesSearch(['Ramp'], searchTerms(null))).toBe(true);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('ignores the punctuation people do not type', () => {
    expect(matchesSearch(['Ramp'], searchTerms('"ramp",'))).toBe(true);
  });

  it('keeps the punctuation that is part of a name', () => {
    expect(matchesSearch(['C++ Engineer'], searchTerms('c++'))).toBe(true);
    expect(matchesSearch(['Data & Insights'], searchTerms('&'))).toBe(true);
    expect(matchesSearch(['Ramp', 'Product Designer, iOS'], searchTerms('ios'))).toBe(true);
  });

  it('skips fields that are missing', () => {
    expect(matchesSearch(['Ramp', null, undefined], searchTerms('ramp'))).toBe(true);
  });
});

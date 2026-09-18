import { describe, expect, it } from 'vitest';
import { paletteHits, rankHits } from './rank';
import { PER_SOURCE_LIMIT, TOTAL_LIMIT, type SearchHit } from './sources';

/**
 * The order the palette shows things in, and the caps on it.
 *
 * The same rules run on both sides now -- the server ranks what the sources
 * returned, the browser ranks the list it holds -- so these are the tests that
 * say the two cannot drift apart.
 */

const hit = (title: string, overrides: Partial<SearchHit> = {}): SearchHit => ({
  module: 'jobs',
  kind: 'company',
  id: title,
  title,
  subtitle: 'Company · Job search',
  href: `/jobs/companies/${title}`,
  ...overrides,
});

describe('the ranking', () => {
  it('puts a match at the start of a word above one in the middle', () => {
    const ranked = rankHits([hit('Paracetamol'), hit('Acme')], 'ac');
    expect(ranked[0].title).toBe('Acme');
  });

  it('drops what does not match at all', () => {
    expect(rankHits([hit('Zebra')], 'qq')).toEqual([]);
  });

  it('finds a thing by the words its source said to look for it by', () => {
    // A role is called "Staff Engineer" and is looked for by the company.
    const ranked = rankHits(
      [hit('Staff Engineer', { kind: 'role', subtitle: 'Role at Acme · Job search', match: 'Acme' })],
      'acme',
    );
    expect(ranked).toHaveLength(1);
  });

  it('does not match against the subtitle, which is boilerplate', () => {
    // "Company · Job search" contains an a and then a c, so matching it would
    // make "ac" find every company there is.
    expect(rankHits([hit('Zebra')], 'ac')).toEqual([]);
  });

  it('is stable for two things that score the same', () => {
    const ranked = rankHits([hit('Acme Two'), hit('Acme One')], 'ac');
    expect(ranked.map((h) => h.title)).toEqual(['Acme One', 'Acme Two']);
  });
});

describe('the caps on a ranked list', () => {
  it('takes only so many from any one workspace', () => {
    const many = Array.from({ length: 10 }, (_, i) => hit(`Acme ${i}`));
    expect(paletteHits(many, 'ac', { perModule: 3 })).toHaveLength(3);
  });

  it('lets another workspace have its own share', () => {
    const kept = paletteHits(
      [
        ...Array.from({ length: 4 }, (_, i) => hit(`Acme ${i}`)),
        ...Array.from({ length: 4 }, (_, i) =>
          hit(`Acorn ${i}`, { module: 'vault', kind: 'note' }),
        ),
      ],
      'ac',
      { perModule: 2 },
    );

    expect(kept.filter((h) => h.module === 'jobs')).toHaveLength(2);
    expect(kept.filter((h) => h.module === 'vault')).toHaveLength(2);
  });

  it('caps the whole list however many workspaces answered', () => {
    const kept = paletteHits(
      [
        ...Array.from({ length: 5 }, (_, i) => hit(`Acme ${i}`)),
        ...Array.from({ length: 5 }, (_, i) =>
          hit(`Acorn ${i}`, { module: 'vault', kind: 'note' }),
        ),
      ],
      'ac',
      { perModule: 5, total: 4 },
    );

    expect(kept).toHaveLength(4);
  });

  it('keeps the best of what it had to choose between', () => {
    // Capping after the ranking rather than before it is the difference
    // between dropping the worst rows and dropping whichever ones came back
    // first.
    const kept = paletteHits([hit('Paracetamol'), hit('Acme')], 'ac', { perModule: 1 });
    expect(kept.map((h) => h.title)).toEqual(['Acme']);
  });

  it('falls back to the caps the palette has always used', () => {
    const many = Array.from({ length: TOTAL_LIMIT + 5 }, (_, i) => hit(`Acme ${i}`));
    expect(paletteHits(many, 'ac')).toHaveLength(Math.min(PER_SOURCE_LIMIT, TOTAL_LIMIT));
  });
});

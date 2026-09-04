import { describe, expect, it } from 'vitest';
import {
  attributeKey,
  builtInTemplateFor,
  fieldsForItem,
  mergeAttributeValues,
  parseAttributeValues,
  parseTemplateFields,
  searchProviderFor,
  searchTermsFor,
  templateFor,
} from '@/lib/inventory/attributes';

describe('attributeKey', () => {
  it('slugifies a label into a stable key', () => {
    expect(attributeKey('Playing time (min)')).toBe('playing_time_min');
    expect(attributeKey('BGG rating')).toBe('bgg_rating');
  });

  it('strips accents and edge separators', () => {
    expect(attributeKey('  Épaisseur  ')).toBe('epaisseur');
  });
});

describe('builtInTemplateFor', () => {
  it('gives board games their own fields', () => {
    expect(builtInTemplateFor('board-games').map((f) => f.key)).toEqual([
      'players',
      'playing_time_min',
      'bgg_rating',
      'bgg_link',
    ]);
  });

  it('falls back to the parent category for a child slug', () => {
    expect(builtInTemplateFor('clothing-shoes').map((f) => f.key)).toContain('size');
  });

  it('is empty for a category with nothing defined', () => {
    expect(builtInTemplateFor('groceries')).toEqual([]);
    expect(builtInTemplateFor(null)).toEqual([]);
  });
});

describe('parseTemplateFields', () => {
  it('keeps well-formed fields and drops the rest', () => {
    expect(
      parseTemplateFields([
        { key: 'brand', label: 'Brand', type: 'text' },
        { label: 'Site', type: 'url' },
        { label: '' },
        'nonsense',
        { key: 'brand', label: 'Brand again' },
      ]),
    ).toEqual([
      { key: 'brand', label: 'Brand', type: 'text', inSearch: false },
      { key: 'site', label: 'Site', type: 'url', inSearch: false },
    ]);
  });

  it('reads a field out of the search unless it says otherwise', () => {
    // Every template written before the flag existed searched on the title
    // alone, and must keep doing so.
    expect(parseTemplateFields([{ key: 'x', label: 'X' }])[0]?.inSearch).toBe(false);
    expect(
      parseTemplateFields([{ key: 'x', label: 'X', inSearch: true }])[0]?.inSearch,
    ).toBe(true);
  });

  it('defaults an unknown type to text', () => {
    expect(parseTemplateFields([{ key: 'x', label: 'X', type: 'colour' }])[0]?.type).toBe('text');
  });
});

describe('templateFor', () => {
  it('prefers a saved template, empty or not', () => {
    expect(
      templateFor({ categorySlug: 'board-games', savedFields: [], hasSavedTemplate: true }),
    ).toEqual([]);
  });

  it('uses the built-in one until a template is saved', () => {
    expect(
      templateFor({ categorySlug: 'books', savedFields: null, hasSavedTemplate: false }).map(
        (f) => f.key,
      ),
    ).toEqual(['isbn', 'genre', 'format']);
  });
});

describe('parseAttributeValues', () => {
  it('stringifies numbers and drops empties', () => {
    expect(parseAttributeValues({ players: '2-4', bgg_rating: 7.8, blank: '', missing: null })).toEqual(
      { players: '2-4', bgg_rating: '7.8' },
    );
  });

  it('is empty for anything that is not an object', () => {
    expect(parseAttributeValues(['a'])).toEqual({});
    expect(parseAttributeValues(null)).toEqual({});
  });
});

describe('fieldsForItem', () => {
  it('appends values the template no longer defines', () => {
    const fields = fieldsForItem(
      [{ key: 'brand', label: 'Brand', type: 'text', inSearch: false }],
      { brand: 'Ravensburger', old_field: 'kept' },
    );
    expect(fields.map((f) => f.key)).toEqual(['brand', 'old_field']);
    expect(fields[1]?.label).toBe('Old field');
  });
});

describe('mergeAttributeValues', () => {
  it('overwrites, trims, and deletes what was cleared', () => {
    expect(
      mergeAttributeValues(
        { players: '2-4', genre: 'strategy' },
        { players: ' 1-5 ', genre: '' },
      ),
    ).toEqual({ players: '1-5' });
  });
});

describe('searchProviderFor', () => {
  it('only board games have a search behind them so far', () => {
    expect(searchProviderFor('board-games')).toBe('bgg');
    expect(searchProviderFor('books')).toBeNull();
  });
});

describe('searchTermsFor', () => {
  const template = [
    { key: 'edition', label: 'Edition', type: 'text' as const, inSearch: true },
    { key: 'genre', label: 'Genre', type: 'text' as const, inSearch: false },
    { key: 'link', label: 'Link', type: 'url' as const, inSearch: true },
  ];

  it('takes the marked fields, in template order', () => {
    expect(
      searchTermsFor(template, { genre: 'Sci-fi', edition: 'Folio Society' }),
    ).toEqual(['Folio Society']);
  });

  it('skips a marked field this item left blank', () => {
    // The marking says the detail identifies the listing. A detail nobody
    // filled in identifies nothing, and a trailing space narrows no search.
    expect(searchTermsFor(template, { edition: '   ' })).toEqual([]);
    expect(searchTermsFor(template, {})).toEqual([]);
  });

  it('never puts a URL in a keyword search', () => {
    expect(searchTermsFor(template, { link: 'https://example.com' })).toEqual([]);
  });
});

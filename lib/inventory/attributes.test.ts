import { describe, expect, it } from 'vitest';
import {
  attributeKey,
  builtInTemplateFor,
  fieldsForItem,
  mergeAttributeValues,
  parseAttributeValues,
  parseTemplateFields,
  searchProviderFor,
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
      { key: 'brand', label: 'Brand', type: 'text' },
      { key: 'site', label: 'Site', type: 'url' },
    ]);
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
      [{ key: 'brand', label: 'Brand', type: 'text' }],
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

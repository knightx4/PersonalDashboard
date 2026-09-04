import { describe, expect, it } from 'vitest';
import {
  attributeFacets,
  attributeLabelMap,
  matchesAttributeFilters,
  parseAttributeFilters,
  serializeAttributeFilter,
} from '@/lib/inventory/attribute-filters';

describe('parseAttributeFilters', () => {
  it('reads a single param and a repeated one', () => {
    expect(parseAttributeFilters('genre:Fantasy')).toEqual([
      { key: 'genre', value: 'Fantasy' },
    ]);
    expect(parseAttributeFilters(['genre:Fantasy', 'brand:Nike'])).toEqual([
      { key: 'genre', value: 'Fantasy' },
      { key: 'brand', value: 'Nike' },
    ]);
  });

  it('keeps colons inside the value', () => {
    expect(parseAttributeFilters('bgg_link:https://boardgamegeek.com/1')).toEqual([
      { key: 'bgg_link', value: 'https://boardgamegeek.com/1' },
    ]);
  });

  it('drops malformed, empty and duplicate entries', () => {
    expect(parseAttributeFilters(['genre', ':Fantasy', 'genre:', 'GEN RE:x'])).toEqual([]);
    expect(parseAttributeFilters(['genre:Fantasy', 'genre:fantasy'])).toEqual([
      { key: 'genre', value: 'Fantasy' },
    ]);
    expect(parseAttributeFilters(undefined)).toEqual([]);
  });

  it('round-trips through the query-string form', () => {
    const filter = { key: 'genre', value: 'Science Fiction' };
    expect(parseAttributeFilters(serializeAttributeFilter(filter))).toEqual([filter]);
  });
});

describe('matchesAttributeFilters', () => {
  const values = { genre: 'Fantasy', brand: 'Nike' };

  it('requires every filter to match, case-insensitively', () => {
    expect(matchesAttributeFilters(values, [])).toBe(true);
    expect(matchesAttributeFilters(values, [{ key: 'genre', value: 'fantasy' }])).toBe(true);
    expect(
      matchesAttributeFilters(values, [
        { key: 'genre', value: 'Fantasy' },
        { key: 'brand', value: 'Nike' },
      ]),
    ).toBe(true);
  });

  it('rejects a missing or different value', () => {
    expect(matchesAttributeFilters(values, [{ key: 'genre', value: 'Horror' }])).toBe(false);
    expect(matchesAttributeFilters(values, [{ key: 'size', value: 'M' }])).toBe(false);
  });
});

describe('attributeFacets', () => {
  it('collects the values items actually carry', () => {
    const facets = attributeFacets([
      { attributes: { genre: 'Fantasy', format: 'Paperback' } },
      { attributes: { genre: 'Horror' } },
      { attributes: {} },
      { attributes: null },
    ]);
    expect(facets.map((f) => f.key)).toEqual(['format', 'genre']);
    expect(facets.find((f) => f.key === 'genre')?.values).toEqual(['Fantasy', 'Horror']);
  });

  it('folds case-different spellings into one option', () => {
    const [facet] = attributeFacets([
      { attributes: { genre: 'Fantasy' } },
      { attributes: { genre: 'fantasy' } },
    ]);
    expect(facet?.values).toEqual(['Fantasy']);
  });

  it('labels keys from the templates, falling back to the key itself', () => {
    const labels = attributeLabelMap([], ['books']);
    const facets = attributeFacets(
      [{ attributes: { genre: 'Fantasy', shelf_spot: 'B3' } }],
      labels,
    );
    expect(facets.find((f) => f.key === 'genre')?.label).toBe('Genre');
    expect(facets.find((f) => f.key === 'shelf_spot')?.label).toBe('Shelf spot');
  });
});

describe('attributeLabelMap', () => {
  it('lets a saved template override the built-in label', () => {
    const labels = attributeLabelMap(
      [[{ key: 'genre', label: 'Shelf genre', type: 'text', inSearch: false }]],
      ['books'],
    );
    expect(labels.get('genre')).toBe('Shelf genre');
    expect(labels.get('format')).toBe('Format');
  });
});

import { describe, expect, it } from 'vitest';
import { buildSearchTags, expandSearchQuery } from './search-tags';
import { scoreInventoryMatch } from './search';

describe('expandSearchQuery', () => {
  it('expands makeup into cosmetics synonyms', () => {
    const terms = expandSearchQuery('makeup');
    expect(terms).toContain('makeup');
    expect(terms).toContain('lipstick');
    expect(terms).toContain('beauty');
  });

  it('expands lipstick into makeup', () => {
    const terms = expandSearchQuery('lipstick');
    expect(terms).toContain('makeup');
    expect(terms).toContain('cosmetics');
  });
});

describe('buildSearchTags + scoreInventoryMatch', () => {
  it('tags a lipstick-like product so makeup finds it', () => {
    const tags = buildSearchTags({
      name: 'Rare Beauty Soft Pinch Tinted Lip Oil',
      shortName: 'Soft Pinch tinted lip oil',
      categorySlug: 'beauty',
      categoryName: 'Beauty',
    });
    expect(tags).toContain('makeup');

    const score = scoreInventoryMatch(
      {
        id: '1',
        name: 'Rare Beauty Soft Pinch Tinted Lip Oil',
        short_name: 'Soft Pinch tinted lip oil',
        variant: null,
        search_tags: tags,
        category_name: 'Beauty',
      },
      'makeup',
    );
    expect(score).toBeGreaterThan(0);
  });

  it('tags kitchen cookware', () => {
    const tags = buildSearchTags({
      name: 'Lodge Cast Iron Skillet 10 Inch',
      shortName: 'Cast iron skillet',
      categorySlug: 'kitchen',
    });
    expect(tags).toContain('kitchen');
    expect(tags).toContain('cookware');
  });
});

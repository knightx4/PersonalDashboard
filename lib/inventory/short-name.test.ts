import { describe, expect, it } from 'vitest';
import { coalesceShortName, shortNameFromTitle } from './short-name';

describe('shortNameFromTitle', () => {
  it('strips Amazon-style comma lists', () => {
    const long =
      'Boncart Wood Furniture Repair Kit, Wood Touch up Fillers, Repair Scratches, Cracks, Paint Chips';
    expect(shortNameFromTitle(long)).toBe('Boncart Wood Furniture Repair Kit');
  });

  it('caps word count on very long titles', () => {
    const title = 'One Two Three Four Five Six Seven Eight Nine';
    expect(shortNameFromTitle(title).split(/\s+/).length).toBeLessThanOrEqual(6);
  });
});

describe('coalesceShortName', () => {
  it('prefers a clean model short name', () => {
    expect(
      coalesceShortName(
        'Rare Beauty Soft Pinch Liquid Blush, Longwear Cream Blush',
        'Soft Pinch liquid blush',
      ),
    ).toBe('Soft Pinch liquid blush');
  });

  it('falls back when candidate is empty', () => {
    expect(coalesceShortName('Simple Mug', null)).toBe('Simple Mug');
  });
});

import { describe, expect, it } from 'vitest';
import { CATEGORY_COLOR_OPTIONS, pickCategoryColor, slugifyCategoryName } from './slugify';

describe('slugifyCategoryName', () => {
  it('slugifies names', () => {
    expect(slugifyCategoryName('Camping Gear')).toBe('camping-gear');
  });
});

describe('pickCategoryColor', () => {
  it('picks the first unused palette color', () => {
    expect(pickCategoryColor([])).toBe(CATEGORY_COLOR_OPTIONS[0]);
    expect(pickCategoryColor([CATEGORY_COLOR_OPTIONS[0]])).toBe(CATEGORY_COLOR_OPTIONS[1]);
  });

  it('wraps when all colors are used', () => {
    expect(pickCategoryColor([...CATEGORY_COLOR_OPTIONS])).toBe(CATEGORY_COLOR_OPTIONS[0]);
  });
});

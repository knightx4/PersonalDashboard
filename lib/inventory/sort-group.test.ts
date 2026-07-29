import { describe, expect, it } from 'vitest';
import { groupInventoryItems, sortInventoryItems } from './sort-group';

const items = [
  {
    name: 'Zebra lamp',
    short_name: 'Zebra lamp',
    cost_cents: 2000,
    acquired_at: '2026-03-01',
    merchant_name: 'Amazon',
    category_name: 'Home',
  },
  {
    name: 'Apple mug',
    short_name: 'Apple mug',
    cost_cents: 900,
    acquired_at: '2026-06-01',
    merchant_name: 'Target',
    category_name: 'Kitchen',
  },
];

describe('sortInventoryItems', () => {
  it('sorts by name', () => {
    const sorted = sortInventoryItems(items, 'name');
    expect(sorted.map((i) => i.short_name)).toEqual(['Apple mug', 'Zebra lamp']);
  });

  it('sorts by newest acquired', () => {
    const sorted = sortInventoryItems(items, 'newest');
    expect(sorted[0]?.short_name).toBe('Apple mug');
  });
});

describe('groupInventoryItems', () => {
  it('groups by category', () => {
    const groups = groupInventoryItems(items, 'category');
    expect(groups.map((g) => g.label).sort()).toEqual(['Home', 'Kitchen']);
  });
});

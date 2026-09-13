import { describe, expect, it } from 'vitest';
import { inventoryDisplay, type SortableInventoryItem } from './list-display';
import { groupRows, parseListDisplay, sortRows } from '@/lib/list-display';

/**
 * The inventory list's own sorts and groupings, now that they are a
 * declaration the shared module reads rather than two switch statements.
 *
 * What is worth asserting is what a bookmarked link depends on: the ids, the
 * defaults, and the order each sort actually produces. The parsing, the
 * bucketing and the link building are the shared module's and are tested
 * there.
 */

const items: SortableInventoryItem[] = [
  {
    name: 'Zebra mug',
    short_name: null,
    cost_cents: 1200,
    acquired_at: '2024-02-01',
    category_name: 'Kitchen',
    merchant_name: 'Amazon',
  },
  {
    name: 'Apple case',
    short_name: null,
    cost_cents: 3400,
    acquired_at: '2024-01-15',
    category_name: 'Tech',
    merchant_name: null,
  },
  {
    name: 'Long official product name',
    short_name: 'Blender',
    cost_cents: 900,
    acquired_at: null,
    category_name: 'Kitchen',
    merchant_name: 'Target',
  },
];

const spec = inventoryDisplay<SortableInventoryItem>();

function arranged(params: Record<string, string>) {
  return parseListDisplay(spec, params);
}

describe('the sorts it offers', () => {
  it('opens newest first when the URL says nothing', () => {
    const state = arranged({});
    expect(state.sort).toBe('newest');
    expect(sortRows(items, state).map((item) => item.name)).toEqual([
      'Zebra mug',
      'Apple case',
      'Long official product name',
    ]);
  });

  it('sorts by the name on the row, not the name in the database', () => {
    // "Blender" is a short name over a long official one, and it is what the
    // row shows, so it is what A–Z has to order by.
    const names = sortRows(items, arranged({ sort: 'name' })).map((item) => item.short_name ?? item.name);
    expect(names).toEqual(['Apple case', 'Blender', 'Zebra mug']);
  });

  it('keeps the six ids a bookmarked link could carry', () => {
    expect(spec.sorts.map((sort) => sort.id)).toEqual([
      'newest',
      'oldest',
      'name',
      'price_desc',
      'price_asc',
      'merchant',
    ]);
  });

  it('puts the dearest first on price high to low', () => {
    const sorted = sortRows(items, arranged({ sort: 'price_desc' }));
    expect(sorted.map((item) => item.cost_cents)).toEqual([3400, 1200, 900]);
  });

  it('leaves a row with no merchant at the end of a merchant sort', () => {
    const sorted = sortRows(items, arranged({ sort: 'merchant' }));
    expect(sorted[sorted.length - 1].merchant_name).toBeNull();
  });

  it('falls back to newest rather than emptying the list on an unknown sort', () => {
    expect(arranged({ sort: 'whatever' }).sort).toBe('newest');
  });
});

describe('the groupings it offers', () => {
  it('does not group until asked', () => {
    expect(arranged({}).group).toBe('none');
  });

  it('buckets by category, with the ones that have none last', () => {
    const unfiled = [...items, { ...items[0], name: 'Loose thing', category_name: null }];
    const groups = groupRows(unfiled, arranged({ group: 'category' }).groupBy);
    expect(groups.map((group) => group.label)).toEqual(['Kitchen', 'Tech', 'Uncategorized']);
    expect(groups[0].count).toBe(2);
  });

  it('buckets by month, newest month first, undated last', () => {
    const groups = groupRows(items, arranged({ group: 'month' }).groupBy);
    expect(groups.map((group) => group.label)).toEqual([
      'February 2024',
      'January 2024',
      'Unknown date',
    ]);
  });

  it('totals what is in a bucket', () => {
    const groups = groupRows(items, arranged({ group: 'category' }).groupBy, (rows) =>
      rows.reduce((sum, item) => sum + item.cost_cents, 0),
    );
    expect(groups.find((group) => group.label === 'Kitchen')?.subtotal).toBe(2100);
  });
});

describe('the properties a row can lose', () => {
  it('never offers to hide the name', () => {
    expect(spec.properties?.find((property) => property.id === 'name')?.alwaysOn).toBe(true);
  });

  it('carries what is hidden through the URL', () => {
    expect(arranged({ hide: 'price,category' }).hidden).toEqual(['price', 'category']);
  });
});
